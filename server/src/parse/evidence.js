/** Source metadata always comes from the parsed clause, never from inference. */
export function sourceEvidence(clause) {
  return {
    ref: clause.id || clause.ref, docId: clause.docId, number: clause.number, text: clause.text,
    ...(clause.fileId ? { fileId: clause.fileId, fileName: clause.fileName } : {}),
  };
}
