/**
 * File Preview Grid Component
 *
 * Displays a grid of file previews with thumbnails for images and icons for other file types.
 * Supports removing files with a hover-activated delete button.
 */

import type { ImageAttachment } from "@/lib/types"
import { useT } from "@/lib/i18n"

interface FilePreviewGridProps {
  files: ImageAttachment[]
  onRemove: (fileId: string) => void
}

/**
 * Get color class for file extension badge based on file type.
 */
function getFileColor(fileExt: string | undefined): string {
  return "text-primary"
}

/**
 * Individual file preview card component.
 */
function FilePreviewCard({ file, onRemove }: { file: ImageAttachment; onRemove: (id: string) => void }) {
  const t = useT()
  const isImage = file.mimeType?.startsWith('image/')
  const fileName = file.name || t.file
  const fileExt = fileName.split('.').pop()?.toLowerCase()
  const fileSizeKB = file.size ? Math.round(file.size / 1024) : 0

  return (
    <div className="group relative flex h-24 flex-col overflow-hidden rounded-lg bg-secondary transition-colors hover:bg-muted">
      {isImage ? (
        // Image preview
        <div className="relative h-full w-full">
          <img
            src={file.url}
            alt={fileName}
            className="h-full w-full object-cover"
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1">
            <p className="text-xs text-white truncate" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>
      ) : (
        // File icon preview
        <div className="h-full flex flex-col items-center justify-center p-2 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`mb-1.5 h-8 w-8 ${getFileColor(fileExt)}`}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span className="text-[11px] font-medium text-foreground truncate w-full px-1 mb-0.5" title={fileName}>
            {fileName}
          </span>
          <div className="flex items-center gap-1">
            <span className={`rounded bg-primary-soft px-1 py-0.5 text-[10px] font-bold ${getFileColor(fileExt)}`}>
              {fileExt?.toUpperCase().slice(0, 4) || t.file.toUpperCase()}
            </span>
            {fileSizeKB > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {fileSizeKB}KB
              </span>
            )}
          </div>
        </div>
      )}

      {/* Remove button - always visible on mobile, hover on desktop */}
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onRemove(file.id)
        }}
        className="absolute right-1 top-1 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-card text-muted-foreground opacity-100 transition-colors hover:bg-primary-soft hover:text-primary sm:opacity-0 sm:group-hover:opacity-100"
        type="button"
        title={t.removeFile}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3 h-3"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  )
}

/**
 * Grid of file preview cards.
 *
 * @example
 * ```tsx
 * <FilePreviewGrid
 *   files={attachedFiles}
 *   onRemove={(id) => removeFile(id)}
 * />
 * ```
 */
export function FilePreviewGrid({ files, onRemove }: FilePreviewGridProps) {
  if (files.length === 0) return null

  return (
    <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
      {files.map((file) => (
        <FilePreviewCard key={file.id} file={file} onRemove={onRemove} />
      ))}
    </div>
  )
}
