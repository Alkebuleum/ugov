
import { Link } from 'react-router-dom'

export default function MobileDrawer({open, onClose}:{open:boolean, onClose:()=>void}){
  return (
    <div className={`fixed inset-0 z-30 ${open?'':'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/30 transition-opacity ${open?'opacity-100':'opacity-0'}`} onClick={onClose}/>
      <aside className={`absolute left-0 top-0 h-full w-72 bg-white border-r border-brand-line shadow-card p-4 transition-transform ${open?'translate-x-0':'-translate-x-full'}`}>
        <div className="text-lg font-semibold">uGov</div>
        <nav className="mt-6 flex flex-col gap-2">
          <Link to="/" onClick={onClose} className="px-3 py-2 rounded-lg hover:bg-brand-line/50">Overview</Link>
          <Link to="/discussions" onClick={onClose} className="px-3 py-2 rounded-lg hover:bg-brand-line/50">Discussions</Link>
          <Link to="/proposals" onClick={onClose} className="px-3 py-2 rounded-lg hover:bg-brand-line/50">Proposals</Link>
          <Link to="/treasury" onClick={onClose} className="px-3 py-2 rounded-lg hover:bg-brand-line/50">Treasury</Link>
          <a className="px-3 py-2 rounded-lg text-slate">Connect AmVault</a>
        </nav>
      </aside>
    </div>
  )
}
