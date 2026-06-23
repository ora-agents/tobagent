"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor"

import { Textarea } from "@/components/ui/textarea"

interface PromptMarkdownEditorInnerProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const CODE_BLOCK_LANGUAGES = {
  markdown: "Markdown",
  text: "Plain text",
  json: "JSON",
  yaml: "YAML",
  python: "Python",
  typescript: "TypeScript",
  javascript: "JavaScript",
}

export function PromptMarkdownEditorInner({
  id,
  value,
  onChange,
  placeholder,
}: PromptMarkdownEditorInnerProps) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const currentMarkdownRef = useRef(value)
  const [editorError, setEditorError] = useState<string | null>(null)

  useEffect(() => {
    if (value === currentMarkdownRef.current) return
    currentMarkdownRef.current = value
    editorRef.current?.setMarkdown(value)
  }, [value])

  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      thematicBreakPlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: "markdown" }),
      codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES }),
      diffSourcePlugin({ viewMode: "rich-text" }),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarClassName: "prompt-mdx-toolbar",
        toolbarContents: () => (
          <DiffSourceToggleWrapper options={["rich-text", "source"]}>
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            <Separator />
            <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
            <CodeToggle />
            <Separator />
            <ListsToggle options={["bullet", "number", "check"]} />
            <Separator />
            <CreateLink />
            <InsertTable />
            <InsertCodeBlock />
          </DiffSourceToggleWrapper>
        ),
      }),
    ],
    []
  )

  if (editorError) {
    return (
      <div className="space-y-1.5">
        <Textarea
          id={id}
          value={value}
          onChange={event => onChange(event.target.value)}
          rows={6}
          placeholder={placeholder}
          className="resize-y rounded-lg border-border/80 bg-background font-mono text-sm"
        />
        <p className="text-xs text-destructive">{editorError}</p>
      </div>
    )
  }

  return (
    <MDXEditor
      ref={editorRef}
      markdown={value}
      onChange={(markdown, initialMarkdownNormalize) => {
        if (initialMarkdownNormalize) return
        currentMarkdownRef.current = markdown
        onChange(markdown)
      }}
      onError={payload => setEditorError(payload.error)}
      plugins={plugins}
      className="prompt-mdx-editor"
      contentEditableClassName="prompt-mdx-content"
      spellCheck
      placeholder={placeholder}
    />
  )
}
