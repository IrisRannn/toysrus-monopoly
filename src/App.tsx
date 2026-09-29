import { useEffect, useState } from 'react'
import { socket } from './utils/socket'
import { GameState } from './types'
import BigScreen from './pages/BigScreen'
import Host from './pages/Host'
import Mobile from './pages/Mobile'

// 根据 URL 路径决定渲染哪个端：
//  /            大屏端（投屏）
//  /host        主持人/控制端
//  /m           员工手机端
export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [route] = useState(() => window.location.pathname)

  useEffect(() => {
    socket.on('state:update', (s: GameState) => setState(s))
    return () => { socket.off('state:update') }
  }, [])

  if (!state) {
    return <div style={{ padding: 40, textAlign: 'center', fontSize: 24 }}>连接游戏服务中…</div>
  }

  if (route.startsWith('/host')) return <Host state={state} socket={socket} />
  if (route.startsWith('/m')) return <Mobile state={state} socket={socket} />
  return <BigScreen state={state} socket={socket} />
}
