// Portable metadata references only: never apply these helpers to evaluation inputs or answers.
export function modelFileReference(file) {
  return `<MODEL_DIRECTORY>/${file.replaceAll('\\', '/').split('/').pop()}`;
}

export function portableModelfile(modelfile) {
  return modelfile.replace(/^(FROM[ \t]+)([^\r\n]+)(\r?)$/m, (line, prefix, source, cr) => {
    const file = source.trim().replace(/^"(.*)"$/, '$1').replaceAll('\\', '/');
    if (!/^(?:[a-z]:\/|\/)/i.test(file)) return line;
    const blob = file.match(/\/blobs\/(sha256-[a-f0-9]{64})$/i);
    const reference = blob ? `<OLLAMA_MODELS>/blobs/${blob[1]}` : modelFileReference(file);
    return `${prefix}${reference}${cr}`;
  });
}
