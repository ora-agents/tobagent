"use client"

import dynamic from "next/dynamic"

import { Textarea } from "@/components/ui/textarea"

interface PromptMarkdownEditorProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const PromptMarkdownEditorInner = dynamic(
  () => import("./prompt-markdown-editor-inner").then(mod => mod.PromptMarkdownEditorInner),
  {
    ssr: false,
    loading: () => (
      <Textarea
        readOnly
        rows={3}
        value=""
        placeholder="Loading markdown editor..."
        className="resize-none rounded-lg border-border/80 bg-background text-sm"
      />
    ),
  }
)

export function PromptMarkdownEditor(props: PromptMarkdownEditorProps) {
  return <PromptMarkdownEditorInner {...props} />
}
