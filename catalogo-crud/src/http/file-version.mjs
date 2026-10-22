// Metadata changes also invalidate replacements that keep the same filename.
export function fileVersion(info) {
  return `${info.size.toString(36)}-${info.mtimeMs.toString(36)}-${info.ctimeMs.toString(36)}`;
}
