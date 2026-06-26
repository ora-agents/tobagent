"use client"

import { useEffect } from "react"

function isImageTarget(target: EventTarget | null) {
  return target instanceof HTMLImageElement || (target instanceof Element && target.closest("img"))
}

export function ImageAssetProtection() {
  useEffect(() => {
    const preventImageAction = (event: Event) => {
      if (isImageTarget(event.target)) {
        event.preventDefault()
      }
    }

    document.addEventListener("dragstart", preventImageAction)
    document.addEventListener("contextmenu", preventImageAction)

    return () => {
      document.removeEventListener("dragstart", preventImageAction)
      document.removeEventListener("contextmenu", preventImageAction)
    }
  }, [])

  return null
}
