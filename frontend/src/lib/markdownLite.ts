// Markdown tối giản, tự viết thay vì dùng thư viện render ra HTML string:
// parse ra cây dữ liệu thuần, component sẽ dựng React node trực tiếp từ đó
// (không dùng dangerouslySetInnerHTML) nên an toàn trước XSS theo thiết kế.
export type InlineSegment =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }

export type Block =
  | { type: 'paragraph'; segments: InlineSegment[] }
  | { type: 'list'; items: { checked: boolean | null; segments: InlineSegment[] }[] }

const INLINE_PATTERN = /\*\*(.+?)\*\*|`([^`]+?)`|\*(.+?)\*/g

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, index) })
    if (match[1] !== undefined) segments.push({ type: 'bold', value: match[1] })
    else if (match[2] !== undefined) segments.push({ type: 'code', value: match[2] })
    else if (match[3] !== undefined) segments.push({ type: 'italic', value: match[3] })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
  return segments
}

const LIST_ITEM = /^-\s+(?:\[( |x|X)\]\s+)?(.*)$/

export function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/)
  const blocks: Block[] = []
  let paragraphLines: string[] = []
  let listItems: { checked: boolean | null; segments: InlineSegment[] }[] | null = null

  const flushParagraph = () => {
    if (paragraphLines.length) {
      blocks.push({ type: 'paragraph', segments: parseInline(paragraphLines.join(' ')) })
      paragraphLines = []
    }
  }
  const flushList = () => {
    if (listItems) { blocks.push({ type: 'list', items: listItems }); listItems = null }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') { flushParagraph(); flushList(); continue }
    const listMatch = LIST_ITEM.exec(trimmed)
    if (listMatch) {
      flushParagraph()
      if (!listItems) listItems = []
      const marker = listMatch[1]
      const checked = marker === undefined ? null : marker.toLowerCase() === 'x'
      listItems.push({ checked, segments: parseInline(listMatch[2]) })
    } else {
      flushList()
      paragraphLines.push(trimmed)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}
