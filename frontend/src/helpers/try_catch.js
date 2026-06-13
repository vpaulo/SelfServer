export function escape_html(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function process_error(raw_error, operation_name) {
  const error =
    raw_error instanceof Error ? raw_error : Error(String(raw_error));

  if (operation_name) {
    error.message = `Operation "${operation_name}" failed: ${error.message}`;
  }
  return [error];
}

export async function try_catch(promise, operation_name) {
  try {
    const data = await promise;
    return [null, data];
  } catch (raw_error) {
    return process_error(raw_error, operation_name);
  }
}

export function try_catch_sync(fn, operation_name) {
  if (typeof fn !== "function") {
    const msg = "First parameter is not a function";
    return [
      Error(
        operation_name ? `Operation "${operation_name}" failed: ${msg}` : msg,
      ),
    ];
  }
  try {
    return [null, fn()];
  } catch (raw_error) {
    return process_error(raw_error, operation_name);
  }
}
