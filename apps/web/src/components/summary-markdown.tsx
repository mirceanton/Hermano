import ReactMarkdown from "react-markdown"

/** Renders a delegation's free-text postmortem/report with minimal markdown styling. */
export function SummaryMarkdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:leading-relaxed [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  )
}
