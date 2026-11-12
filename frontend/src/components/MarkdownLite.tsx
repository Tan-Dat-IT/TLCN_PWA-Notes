import { Fragment } from 'react'
import { parseBlocks, type InlineSegment } from '../lib/markdownLite'

function renderSegments(segments: InlineSegment[]) {
  return segments.map((s, i) => {
    if (s.type === 'bold') return <strong key={i}>{s.value}</strong>
    if (s.type === 'italic') return <em key={i}>{s.value}</em>
    if (s.type === 'code') return <code key={i}>{s.value}</code>
    return <Fragment key={i}>{s.value}</Fragment>
  })
}

export default function MarkdownLite({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="note-markdown">
      {blocks.map((block, i) => block.type === 'paragraph'
        ? <p key={i}>{renderSegments(block.segments)}</p>
        : (
          <ul key={i} className="note-markdown-list">
            {block.items.map((item, j) => (
              <li key={j} className={item.checked !== null ? 'note-markdown-check' : undefined}>
                {item.checked !== null && <span aria-hidden="true">{item.checked ? '☑' : '☐'}</span>}
                <span>{renderSegments(item.segments)}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
