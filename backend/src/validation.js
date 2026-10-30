export function validTime(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000)
}

export function validNote(n) {
  // Boolean(...) bọc ngoài: chuỗi && ngắn mạch có thể trả về giá trị toán hạng
  // cuối cùng (vd null, hoặc 1 khi n.deleted=1) thay vì true/false thực sự.
  return Boolean(n && Number.isSafeInteger(n.id) && n.id > 0 &&
    typeof n.serverId === 'string' && n.serverId.length > 0 && n.serverId.length <= 100 &&
    typeof n.title === 'string' && n.title.trim().length > 0 && n.title.length <= 255 &&
    typeof n.content === 'string' && n.content.length <= 100000 &&
    typeof n.tag === 'string' && n.tag.length <= 100 &&
    typeof n.done === 'boolean' && (n.deleted === 0 || n.deleted === 1) &&
    Number.isSafeInteger(n.updatedAt) && n.updatedAt >= 0 && n.updatedAt <= 8640000000000000 &&
    (n.kind === 'note' || n.kind === 'task') &&
    // Phiên bản server mà bản sửa này dựa vào; null = ghi chú mới chưa từng lên server.
    (n.baseVersion === null || (Number.isSafeInteger(n.baseVersion) && n.baseVersion >= 1 && n.baseVersion <= 2147483647)) &&
    [n.createdAt, n.startAt, n.dueAt, n.completedAt, n.deletedAt].every(validTime) &&
    (n.startAt === null || n.dueAt === null || n.dueAt >= n.startAt) &&
    (n.kind !== 'note' || !n.done) && (n.done || n.completedAt === null) && (n.deleted || n.deletedAt === null))
}
