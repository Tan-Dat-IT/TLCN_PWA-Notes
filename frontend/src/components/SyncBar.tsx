import type { SyncStatus } from '../hooks/useSync'

interface Props {
  isOnline: boolean
  status: SyncStatus
  errorMessage: string
  onSyncNow: () => void
}

const STATUS_LABEL: Record<SyncStatus, string> = {
  pending: 'Có thay đổi chờ đồng bộ',
  offline: 'Đang offline - dữ liệu lưu cục bộ',
  syncing: 'Đang đồng bộ...',
  synced: 'Đã đồng bộ với server',
  conflict: 'Có ghi chú bị sửa đồng thời trên thiết bị khác - mở mục "Xung đột đồng bộ" để chọn bản muốn giữ',
  error: 'Chưa đồng bộ được với máy chủ'
}

export default function SyncBar({ isOnline, status, errorMessage, onSyncNow }: Props) {
  return (
    <div className={`sync-bar ${status}`}>
      <span className={`status-dot ${!isOnline || status === 'error' ? 'offline' : 'online'}`} />
      <div className="sync-message" role="status"><span>{STATUS_LABEL[status]}</span>
        {(status === 'error' || status === 'syncing') && errorMessage && <p>{errorMessage}</p>}
      </div>
      {/* Nút đồng bộ thủ công: phương án dự phòng cho trường hợp
          tự động đồng bộ chưa kịp chạy hoặc trình duyệt hạn chế hỗ trợ. */}
      <button onClick={onSyncNow} disabled={!isOnline || status === 'syncing'}>
        Đồng bộ ngay
      </button>
    </div>
  )
}
