import type { Note } from '../db/database'

export function collectExistingTags(notes: Pick<Note, 'tag' | 'deleted'>[]) {
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (note.deleted || !note.tag.trim()) continue
    counts.set(note.tag, (counts.get(note.tag) ?? 0) + 1)
  }
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b, 'vi'))
}

export function foldTag(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi')
}

export function matchingTags(tags: string[], input: string) {
  const query = foldTag(input.trim()).replace(/[\s_-]+/g, '-')
  return tags.filter(tag => foldTag(tag).replace(/[\s_-]+/g, '-').includes(query)).slice(0, 6)
}
