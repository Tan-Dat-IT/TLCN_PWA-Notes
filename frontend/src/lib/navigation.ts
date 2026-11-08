import type { DeadlineFilter } from './stats'

export type Page = 'dashboard' | 'tasks' | 'notes' | 'stats' | 'plan' | 'all' | 'pending' | 'conflicts' | 'trash'
export interface WorkspaceRoute { page: Page; deadline: DeadlineFilter }
const PAGES: Page[] = ['dashboard', 'tasks', 'notes', 'stats', 'plan', 'all', 'pending', 'conflicts', 'trash']
const DEADLINES: DeadlineFilter[] = ['all', 'overdue', 'week', 'unscheduled']

export function readRoute(hash: string): WorkspaceRoute {
  const [path, query] = hash.replace(/^#\/?/, '').split('?')
  const page = PAGES.includes(path as Page) ? path as Page : 'dashboard'
  const filter = new URLSearchParams(query).get('deadline') as DeadlineFilter
  return { page, deadline: page === 'tasks' && DEADLINES.includes(filter) ? filter : 'all' }
}

export function routeHash({ page, deadline }: WorkspaceRoute) {
  return `#/${page}${page === 'tasks' && deadline !== 'all' ? `?deadline=${deadline}` : ''}`
}
