
export type Status = 'Active'|'Submitted'|'Deciding'|'Rejected'
export type Row = { id:number; title:string; author:string; avatar:number; time:string; comments:number; votes:number; status:Status; amount?:string }

export const discussions: Row[] = [
  { id:3336, title:'uGov 2025: Fellowship & Transparency Infrastructure', author:'uGov', avatar:1, time:'21h ago', comments:0, votes:0, status:'Submitted' },
  { id:3334, title:'Voxonomics on Alkebuleum — Prototype of VoxUI', author:'Mr Lyon', avatar:4, time:'2d ago', comments:0, votes:0, status:'Submitted' },
  { id:3332, title:'Low positions...', author:'elqmqn', avatar:2, time:'4d ago', comments:0, votes:0, status:'Submitted' },
]

export const proposals: Row[] = [
  { id:1744, title:'Untitled Post', author:'14p5w…tkg3N', avatar:3, time:'6h ago', comments:0, votes:0, status:'Submitted', amount:'66.00K MAh' },
  { id:1743, title:'DeFi Infrastructure & Tooling Bounty Top-Up by Velocity Labs & Co', author:'Nico⚡', avatar:2, time:'3d ago', comments:3, votes:24, status:'Deciding', amount:'1.00M MAh' },
  { id:1742, title:'“Am-Simple Wallet” Initiative: Build & Market a Layman’s Wallet', author:'Songwriter', avatar:1, time:'3d ago', comments:1, votes:12, status:'Submitted', amount:'250.00K MAh' },
]
