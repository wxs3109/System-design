'use client'

import { type ReactNode, type RefObject } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'

interface WorkbenchShellProps {
  palette: ReactNode
  canvas: ReactNode
  faults: ReactNode
  inspector: ReactNode
  results: ReactNode
  faultsRef: RefObject<ImperativePanelHandle | null>
  inspectorRef: RefObject<ImperativePanelHandle | null>
  resultsRef: RefObject<ImperativePanelHandle | null>
}

export function WorkbenchShell({
  palette, canvas, faults, inspector, results, faultsRef, inspectorRef, resultsRef,
}: WorkbenchShellProps) {
  return (
    <div className="workbench-shell">
      {palette}
      <PanelGroup autoSaveId="system-design-main-layout" className="workbench-main-split" direction="horizontal" keyboardResizeBy={3}>
        <Panel id="workbench-center" minSize={45} order={1}>
          <PanelGroup autoSaveId="system-design-center-layout" className="workbench-center-split" direction="vertical" keyboardResizeBy={3}>
            <Panel id="canvas" minSize={30} order={1}>{canvas}</Panel>
            <PanelResizeHandle className="resize-handle resize-handle--horizontal" aria-label="Resize fault laboratory"><span /></PanelResizeHandle>
            <Panel ref={faultsRef} id="faults" collapsible collapsedSize={0} defaultSize={17} minSize={11} maxSize={40} order={2}
              >{faults}</Panel>
            <PanelResizeHandle className="resize-handle resize-handle--horizontal" aria-label="Resize simulation output"><span /></PanelResizeHandle>
            <Panel ref={resultsRef} id="results" collapsible collapsedSize={0} defaultSize={35} minSize={16} maxSize={65} order={3}
              >{results}</Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="resize-handle resize-handle--vertical" aria-label="Resize properties panel"><span /></PanelResizeHandle>
        <Panel ref={inspectorRef} id="inspector" collapsible collapsedSize={0} defaultSize={24} minSize={18} maxSize={45} order={2}
          >{inspector}</Panel>
      </PanelGroup>
    </div>
  )
}
