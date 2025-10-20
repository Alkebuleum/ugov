
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

export default function Markdown({children}:{children:string}){
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSanitize]}
      components={{
        a: ({node, ...props}) => <a {...props} className="text-brand-primary underline" target="_blank" rel="noreferrer" />,
        h1: props => <h1 className="text-2xl font-semibold mt-4 mb-2" {...props}/>,
        h2: props => <h2 className="text-xl font-semibold mt-4 mb-2" {...props}/>,
        code: props => <code className="px-1.5 py-0.5 rounded bg-brand-line text-ink" {...props}/>
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
