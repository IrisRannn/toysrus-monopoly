import { io, Socket } from 'socket.io-client'

const url = (import.meta.env.VITE_SOCKET_URL as string) || ''

export const socket: Socket = io(url, {
  transports: ['websocket', 'polling'],
})
