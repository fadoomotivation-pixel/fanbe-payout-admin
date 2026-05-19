import { X } from 'lucide-react'
import { useEffect } from 'react'
export function Modal({open,onClose,title,children,size='md'}:any) {
  useEffect(()=>{if(open)document.body.style.overflow='hidden';else document.body.style.overflow='';return()=>{document.body.style.overflow=''}},[open])
  if(!open)return null
  const w:any={sm:'max-w-md',md:'max-w-2xl',lg:'max-w-4xl',xl:'max-w-6xl'}
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/>
      <div className={`relative bg-white shadow-2xl w-full ${w[size]} flex flex-col rounded-t-2xl md:rounded-2xl max-h-[92vh] md:max-h-[90vh]`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 truncate pr-2">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 shrink-0"><X size={16}/></button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 md:p-6">{children}</div>
      </div>
    </div>
  )
}