import { useEffect, useRef, useState } from 'react'
import { AiCancelled, AiError, draftFromText, type AiDraftResult } from '../db/ai'
import { getToken } from '../db/api'
import { getLocalDataRevision } from '../db/database'

interface Options {
  accountKey: string | null
  text: string
  existingTags: string[]
  isOnline: boolean
  onDraft: (result: AiDraftResult) => void
}

/** Lives in App so hiding the chat or navigating does not cancel generation. */
export function useAiDraft({ accountKey, text, existingTags, isOnline, onDraft }: Options) {
  const request = useRef<AbortController | null>(null)
  const account = useRef(accountKey)
  const receive = useRef(onDraft)
  account.current = accountKey
  receive.current = onDraft
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')

  function cancel() {
    request.current?.abort()
    request.current = null
    setLoading(false)
    setError('')
  }

  useEffect(() => {
    cancel()
    return () => { request.current?.abort(); request.current = null }
  }, [accountKey])

  useEffect(() => {
    if (!loading) return
    const started = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [loading])

  async function generate() {
    if (!accountKey || !text.trim() || !isOnline || request.current) return
    const controller = new AbortController()
    const token = getToken(), revision = getLocalDataRevision(), owner = accountKey
    const isCurrent = () => request.current === controller && !controller.signal.aborted &&
      account.current === owner && getToken() === token && getLocalDataRevision() === revision
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await draftFromText(text.trim(), existingTags, controller.signal)
      if (isCurrent()) receive.current(result)
    } catch (err) {
      if (isCurrent() && !(err instanceof AiCancelled)) setError(err instanceof AiError ? err.message : 'Chưa tạo được bản nháp. Bạn hãy thử lại.')
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false) }
    }
  }

  return { loading, elapsed, error, generate, cancel }
}

export type AiDraftController = ReturnType<typeof useAiDraft>
