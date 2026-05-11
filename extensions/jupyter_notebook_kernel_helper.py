#!/usr/bin/env python3
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

try:
    from jupyter_client import KernelManager
    from jupyter_client.kernelspec import KernelSpecManager
except Exception as exc:
    print(json.dumps({
        "id": "startup",
        "ok": False,
        "error": {
            "message": "Could not import jupyter_client in the notebook kernel helper.",
            "hint": "The Pi extension starts this helper via: uv run --with jupyter_client python jupyter_notebook_kernel_helper.py. Check that uv can download/run Python packages.",
            "details": str(exc),
        },
    }), flush=True)
    raise

kernel_manager = None
kernel_client = None
kernel_started = False
kernel_spec_tempdir = None
kernel_options = None


def source_to_text(source):
    if isinstance(source, str):
        return source
    if isinstance(source, list):
        return "".join(str(part) for part in source)
    if source is None:
        return ""
    return str(source)


def split_lines_keep_newline(text):
    if text == "":
        return []
    parts = []
    start = 0
    for i, ch in enumerate(text):
        if ch == "\n":
            parts.append(text[start:i + 1])
            start = i + 1
    if start < len(text):
        parts.append(text[start:])
    return parts


def text_to_source_like(text, like):
    if isinstance(like, list):
        return split_lines_keep_newline(text)
    return text


def truncate_text(value, max_chars):
    text = source_to_text(value).replace("\r", "")
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1] + "…"


def output_summary(output, max_chars):
    output_type = output.get("output_type", "unknown")
    if output_type == "stream":
        return "stream[{}]: {}".format(output.get("name", ""), truncate_text(output.get("text", ""), max_chars))
    if output_type == "error":
        return "error: {}: {}".format(output.get("ename", "Error"), output.get("evalue", ""))
    if output_type in ("execute_result", "display_data"):
        data = output.get("data") or {}
        if "text/plain" in data:
            return "{} text/plain: {}".format(output_type, truncate_text(data["text/plain"], max_chars))
        return "{} data: {}".format(output_type, ", ".join(data.keys()) if data else "(empty)")
    return output_type


def make_error(message, hint=None, details=None):
    error = {"message": message}
    if hint:
        error["hint"] = hint
    if details:
        error["details"] = details
    return error


def send_response(request_id, ok, result=None, error=None):
    payload = {"id": request_id, "ok": ok}
    if ok:
        payload["result"] = result or {}
    else:
        payload["error"] = error or make_error("Unknown notebook helper error.")
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def read_notebook(path):
    try:
        raw = Path(path).read_text(encoding="utf8")
    except Exception as exc:
        raise RuntimeError("Could not read notebook {}: {}".format(path, exc)) from exc
    try:
        notebook = json.loads(raw)
    except Exception as exc:
        raise RuntimeError("Notebook is not valid JSON: {}: {}".format(path, exc)) from exc
    if not isinstance(notebook, dict) or not isinstance(notebook.get("cells"), list):
        raise RuntimeError("File is not a valid .ipynb notebook: missing top-level cells array in {}".format(path))
    return notebook


def write_notebook(path, notebook):
    try:
        Path(path).write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    except Exception as exc:
        raise RuntimeError("Could not write notebook {}: {}".format(path, exc)) from exc


def create_temp_kernelspec(python_path):
    global kernel_spec_tempdir
    kernel_spec_tempdir = tempfile.TemporaryDirectory(prefix="pi-notebook-kernel-")
    spec_name = "pi_python"
    spec_dir = Path(kernel_spec_tempdir.name) / spec_name
    spec_dir.mkdir(parents=True, exist_ok=True)
    kernel_json = {
        "argv": [python_path, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
        "display_name": "Pi Notebook ({})".format(python_path),
        "language": "python",
    }
    (spec_dir / "kernel.json").write_text(json.dumps(kernel_json), encoding="utf8")
    return spec_name, KernelSpecManager(kernel_dirs=[kernel_spec_tempdir.name])


def start_kernel(options):
    global kernel_manager, kernel_client, kernel_started, kernel_options
    if kernel_started:
        return True

    cwd = options.get("cwd") or os.getcwd()
    python_path = options.get("python_path")
    kernel_name = options.get("kernel_name")

    try:
        if python_path:
            spec_name, spec_manager = create_temp_kernelspec(python_path)
            kernel_manager = KernelManager(kernel_name=spec_name, kernel_spec_manager=spec_manager)
        else:
            kernel_manager = KernelManager(kernel_name=kernel_name or "python3")

        kernel_manager.start_kernel(cwd=cwd)
        kernel_client = kernel_manager.client()
        kernel_client.start_channels()
        kernel_client.wait_for_ready(timeout=30)
        kernel_started = True
        kernel_options = dict(options)
        return False
    except Exception as exc:
        hint = None
        if python_path:
            hint = "Make sure the interpreter exists and has ipykernel installed: {} -m pip install ipykernel".format(python_path)
        else:
            hint = "Check that the Jupyter kernelspec exists: jupyter kernelspec list"
        message = "Could not start notebook kernel. {}".format(exc)
        if hint:
            message += " Hint: " + hint
        raise RuntimeError(message) from exc


def shutdown_kernel():
    global kernel_manager, kernel_client, kernel_started, kernel_spec_tempdir, kernel_options
    if kernel_client is not None:
        try:
            kernel_client.stop_channels()
        except Exception:
            pass
    if kernel_manager is not None:
        try:
            kernel_manager.shutdown_kernel(now=True)
        except Exception:
            pass
    kernel_manager = None
    kernel_client = None
    kernel_started = False
    kernel_options = None
    if kernel_spec_tempdir is not None:
        try:
            kernel_spec_tempdir.cleanup()
        except Exception:
            pass
    kernel_spec_tempdir = None


def restart_kernel():
    global kernel_started
    if kernel_manager is None or not kernel_started:
        return {"restarted": False, "message": "No kernel was running."}
    try:
        kernel_manager.restart_kernel(now=True)
        kernel_client.wait_for_ready(timeout=30)
        return {"restarted": True}
    except Exception as exc:
        raise RuntimeError("Could not restart notebook kernel: {}".format(exc)) from exc


def convert_message_to_output(msg):
    msg_type = msg.get("msg_type")
    content = msg.get("content", {})
    if msg_type == "stream":
        return {"output_type": "stream", "name": content.get("name", "stdout"), "text": content.get("text", "")}
    if msg_type == "display_data":
        output = {"output_type": "display_data", "data": content.get("data", {}), "metadata": content.get("metadata", {})}
        if "transient" in content:
            output["transient"] = content["transient"]
        return output
    if msg_type == "execute_result":
        return {
            "output_type": "execute_result",
            "execution_count": content.get("execution_count"),
            "data": content.get("data", {}),
            "metadata": content.get("metadata", {}),
        }
    if msg_type == "error":
        return {
            "output_type": "error",
            "ename": content.get("ename", "Error"),
            "evalue": content.get("evalue", ""),
            "traceback": content.get("traceback", []),
        }
    return None


def execute_code(code, timeout, stop_on_error):
    msg_id = kernel_client.execute(code, silent=False, store_history=True, allow_stdin=False, stop_on_error=stop_on_error)
    outputs = []
    execution_count = None
    error = None
    deadline = time.monotonic() + timeout

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Cell execution timed out after {} seconds.".format(timeout))
        try:
            msg = kernel_client.get_iopub_msg(timeout=remaining)
        except Exception as exc:
            raise TimeoutError("Timed out waiting for cell output after {} seconds.".format(timeout)) from exc

        if msg.get("parent_header", {}).get("msg_id") != msg_id:
            continue

        msg_type = msg.get("msg_type")
        content = msg.get("content", {})

        if msg_type == "status" and content.get("execution_state") == "idle":
            break
        if msg_type == "execute_input":
            execution_count = content.get("execution_count")
            continue
        if msg_type == "clear_output":
            outputs = []
            continue

        output = convert_message_to_output(msg)
        if output is not None:
            outputs.append(output)
            if output.get("output_type") == "error":
                error = output

    # Drain shell reply if available; it can contain the final status/error too.
    try:
        while True:
            shell_msg = kernel_client.get_shell_msg(timeout=0.2)
            if shell_msg.get("parent_header", {}).get("msg_id") == msg_id:
                content = shell_msg.get("content", {})
                if content.get("status") == "error" and error is None:
                    error = {
                        "output_type": "error",
                        "ename": content.get("ename", "Error"),
                        "evalue": content.get("evalue", ""),
                        "traceback": content.get("traceback", []),
                    }
                break
    except Exception:
        pass

    return outputs, execution_count, error


def execute_request(request):
    path = request["path"]
    indexes = [int(i) for i in request.get("cell_indexes", [])]
    timeout = int(request.get("timeout") or 60)
    save_outputs = bool(request.get("save_outputs", True))
    return_outputs = bool(request.get("return_outputs", True))
    stop_on_error = bool(request.get("stop_on_error", True))
    max_output_chars = int(request.get("max_output_chars") or 1000)

    options = {
        "cwd": request.get("cwd"),
        "python_path": request.get("python_path"),
        "kernel_name": request.get("kernel_name"),
    }
    reused = start_kernel(options)

    notebook = read_notebook(path)
    cells = notebook.get("cells", [])
    executed = []
    error_count = 0

    for index in indexes:
        if index < 0 or index >= len(cells):
            raise RuntimeError("Cell index {} is out of range. Notebook has {} cells.".format(index, len(cells)))
        cell = cells[index]
        if cell.get("cell_type") != "code":
            continue

        outputs, execution_count, error = execute_code(source_to_text(cell.get("source")), timeout, stop_on_error)
        if save_outputs:
            cell["outputs"] = outputs
            cell["execution_count"] = execution_count
        output_summaries = []
        if return_outputs:
            output_summaries = [output_summary(output, max_output_chars) for output in outputs]
        executed.append({
            "index": index,
            "id": cell.get("id"),
            "execution_count": execution_count,
            "outputs": outputs if return_outputs else [],
            "output_summaries": output_summaries,
            "error": error,
        })
        if error is not None:
            error_count += 1
            if stop_on_error:
                break

    if save_outputs:
        write_notebook(path, notebook)

    return {
        "kernel_reused": reused,
        "executed_indexes": [cell["index"] for cell in executed],
        "cells": executed,
        "error_count": error_count,
    }


def handle_request(request):
    op = request.get("op")
    if op == "execute":
        return execute_request(request)
    if op == "restart":
        return restart_kernel()
    if op == "shutdown":
        shutdown_kernel()
        return {"shutdown": True}
    raise RuntimeError("Unknown notebook helper operation: {}".format(op))


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except Exception as exc:
            send_response("unknown", False, error=make_error("Helper received invalid JSON.", details=str(exc)))
            continue
        request_id = str(request.get("id", "unknown"))
        try:
            result = handle_request(request)
            send_response(request_id, True, result=result)
        except TimeoutError as exc:
            send_response(request_id, False, error=make_error(str(exc), hint="Increase timeout, restart the kernel, or inspect the cell for blocking input/long-running code."))
        except RuntimeError as exc:
            msg = str(exc)
            hint = None
            if "No module named ipykernel_launcher" in msg or "ipykernel" in msg:
                py = request.get("python_path") or "the selected Python interpreter"
                hint = "Install ipykernel in the selected environment: {} -m pip install ipykernel".format(py)
            send_response(request_id, False, error=make_error(msg, hint=hint))
        except Exception as exc:
            send_response(request_id, False, error=make_error("Unexpected notebook helper error: {}".format(exc), details=traceback.format_exc(limit=20)))

    shutdown_kernel()


if __name__ == "__main__":
    main()
