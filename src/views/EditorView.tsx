import RightPanelContainer from '../components/layout/RightPanelContainer';
import BottomBar from '../components/panel/BottomBar';
import Editor from '../components/panel/Editor';
import { Orientation } from '../components/ui/AppProperties';
import Resizer from '../components/ui/Resizer';
import { useContextMenus } from '../hooks/useContextMenus';

const EditorView = () => {
  return (
    <div className="flex flex-row flex-grow h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        <Editor
          onContextMenu={handleEditorContextMenu}
          onZoomed={handleUserTransform}
          transformWrapperRef={transformWrapperRef}
          onZoomChange={handleZoomChange}
        />
        <Resizer direction={Orientation.Horizontal} onMouseDown={createResizeHandler('bottom', bottomPanelHeight)} />
        <BottomBar
          onClearSelection={handleClearSelection}
          onContextMenu={handleThumbnailContextMenu}
          onCopy={handleCopyAdjustments}
          onImageSelect={handleImageClick}
          onPaste={() => handlePasteAdjustments()}
          onRate={handleRate}
          onZoomChange={handleZoomChange}
        />
      </div>

      <Resizer onMouseDown={createResizeHandler('right', rightPanelWidth)} direction={Orientation.Vertical} />
      <RightPanelContainer
        onDeletePatch={handleDeleteAiPatch}
        onGenerativeReplace={handleGenerativeReplace}
        onTogglePatchVisibility={handleToggleAiPatchVisibility}
        setCustomEscapeHandler={setCustomEscapeHandler}
      />
    </div>
  );
};

export default EditorView;
