import { describe, it, expect } from 'vitest'
import { parseInline, parseBlocks } from './markdownLite'

describe('parseInline', () => {
  it('trả về một đoạn text khi không có định dạng', () => {
    expect(parseInline('xin chào')).toEqual([{ type: 'text', value: 'xin chào' }])
  })
  it('nhận diện **bold**, *italic*, `code`', () => {
    expect(parseInline('**đậm** và *nghiêng* và `code`')).toEqual([
      { type: 'bold', value: 'đậm' },
      { type: 'text', value: ' và ' },
      { type: 'italic', value: 'nghiêng' },
      { type: 'text', value: ' và ' },
      { type: 'code', value: 'code' }
    ])
  })
  it('không nhầm ** thành hai * liên tiếp', () => {
    const segments = parseInline('**A** *B*')
    expect(segments[0]).toEqual({ type: 'bold', value: 'A' })
    expect(segments[segments.length - 1]).toEqual({ type: 'italic', value: 'B' })
  })
})

describe('parseBlocks', () => {
  it('gộp các dòng liên tiếp thành một paragraph', () => {
    const blocks = parseBlocks('dòng 1\ndòng 2')
    expect(blocks).toEqual([{ type: 'paragraph', segments: [{ type: 'text', value: 'dòng 1 dòng 2' }] }])
  })
  it('dòng trống tách thành hai paragraph riêng', () => {
    const blocks = parseBlocks('A\n\nB')
    expect(blocks).toHaveLength(2)
  })
  it('nhận diện danh sách gạch đầu dòng', () => {
    const blocks = parseBlocks('- việc 1\n- việc 2')
    expect(blocks).toEqual([{
      type: 'list',
      items: [
        { checked: null, segments: [{ type: 'text', value: 'việc 1' }] },
        { checked: null, segments: [{ type: 'text', value: 'việc 2' }] }
      ]
    }])
  })
  it('nhận diện checkbox đã tick và chưa tick', () => {
    const blocks = parseBlocks('- [ ] chưa xong\n- [x] đã xong')
    expect(blocks).toEqual([{
      type: 'list',
      items: [
        { checked: false, segments: [{ type: 'text', value: 'chưa xong' }] },
        { checked: true, segments: [{ type: 'text', value: 'đã xong' }] }
      ]
    }])
  })
  it('paragraph và list xen kẽ tạo nhiều block riêng biệt', () => {
    const blocks = parseBlocks('Tiêu đề\n- việc 1\n- việc 2\nGhi chú thêm')
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'list', 'paragraph'])
  })
  it('chuỗi rỗng trả về mảng rỗng', () => {
    expect(parseBlocks('')).toEqual([])
  })
})
