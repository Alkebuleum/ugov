
export default function Avatar({name, seed}:{name:string, seed:number}){
  const s = (seed % 4) + 1
  const initials = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()
  return <span className={`avatar s${s} w-7 h-7 text-xs`}>{initials}</span>
}
