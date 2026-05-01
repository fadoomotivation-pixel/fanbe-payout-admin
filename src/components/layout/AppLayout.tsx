// Re-export AppShell as both default and named AppLayout
import AppShell from './AppShell.jsx'
export { AppShell as default }
export function AppLayout(props: any) {
  return <AppShell {...props} />
}
