import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error:', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="workspace-content" role="alert">
      <h1>Không thể mở dữ liệu trên thiết bị</h1>
      <p>Hãy kiểm tra quyền lưu trữ và dung lượng trình duyệt, sau đó thử tải lại. Không xóa dữ liệu website nếu bạn còn ghi chú chưa đồng bộ.</p>
      <button onClick={() => window.location.reload()}>Tải lại ứng dụng</button>
    </main>
  }
}
