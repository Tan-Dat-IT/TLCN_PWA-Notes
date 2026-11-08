import { describe, expect, it } from 'vitest'
import { collectExistingTags, matchingTags } from './tags'

describe('existing tags', () => {
  it('ranks active tags by usage then Vietnamese name without rewriting their values', () => {
    expect(collectExistingTags([
      { tag: 'Học tập', deleted: 0 }, { tag: 'Học tập', deleted: 0 },
      { tag: 'cong-viec', deleted: 0 }, { tag: 'ca-nhan', deleted: 0 },
      { tag: 'deleted-only', deleted: 1 }, { tag: ' ', deleted: 0 }
    ])).toEqual(['Học tập', 'ca-nhan', 'cong-viec'])
  })

  it('matches case, accents, spaces and hyphens but returns the original stored tag', () => {
    expect(matchingTags(['Học tập', 'cong-viec', 'đồ-án'], 'HOC-TAP')).toEqual(['Học tập'])
    expect(matchingTags(['Học tập', 'cong-viec', 'đồ-án'], 'do an')).toEqual(['đồ-án'])
  })

  it('limits visible suggestions to six and handles an empty list', () => {
    expect(matchingTags(Array.from({ length: 10 }, (_, i) => `tag-${i}`), '')).toHaveLength(6)
    expect(matchingTags([], 'học')).toEqual([])
  })
})
