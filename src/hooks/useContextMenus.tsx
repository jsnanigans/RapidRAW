import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useBloc, useBlocActions } from '@blac/react';
import {
  Aperture,
  Check,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Edit,
  FileEdit,
  Folder,
  FolderInput,
  FolderPlus,
  Images,
  LayoutTemplate,
  Redo,
  RotateCcw,
  Star,
  Save,
  Palette,
  Tag,
  Trash2,
  Undo,
  X,
  Pin,
  PinOff,
  Users,
  Gauge,
  Grip,
} from 'lucide-react';
import {
  ModalsCubit,
  NavigationCubit,
  LibraryCubit,
  EditorCubit,
  ClipboardCubit,
  UICubit,
} from '../cubits';
import { useContextMenu } from '../context/ContextMenuContext';
import TaggingSubMenu from '../context/TaggingSubMenu';
import {
  Adjustments,
  Color,
  COLOR_LABELS,
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
  normalizeLoadedAdjustments,
} from '../utils/adjustments';
import {
  AppSettings,
  Invokes,
  ImageFile,
  OPTION_SEPARATOR,
  Panel,
} from '../components/ui/AppProperties';

interface Metadata {
  adjustments: Adjustments;
  rating: number;
  tags: Array<string> | null;
  version: number;
}

interface ContextMenuHandlers {
  handleImageSelect: (path: string) => void;
  executeDelete: (paths: string[], options?: { includeAssociated: boolean }) => void;
  handleCopyAdjustments: () => void;
  handlePasteAdjustments: (paths?: string[]) => void;
  handleRate: (rating: number, paths?: string[]) => void;
  handleSetColorLabel: (color: string | null, paths?: string[]) => void;
  handleRenameFiles: (paths: string[]) => void;
  handleResetAdjustments: (paths?: string[]) => void;
  handleLibraryRefresh: () => void;
  handleTogglePinFolder: (path: string) => void;
  handleImportClick: (targetPath: string) => void;
  handleSelectSubfolder: (path: string) => Promise<void>;
  handleTagsChanged: (paths: string[], tags: { tag: string; isUser: boolean }[]) => void;
  resetAdjustmentsHistory: (adjustments: Adjustments) => void;
  undo: () => void;
  redo: () => void;
}

interface UseContextMenusOptions {
  handlers: ContextMenuHandlers;
  appSettings: AppSettings | null;
  copiedAdjustments: Partial<Adjustments> | null;
  canUndo: boolean;
  canRedo: boolean;
}

export function useContextMenus(options: UseContextMenusOptions) {
  const { handlers, appSettings, copiedAdjustments, canUndo, canRedo } = options;
  
  const [editorState, editorCubit] = useBloc(EditorCubit);
  const [libraryState, libraryCubit] = useBloc(LibraryCubit);
  const [navigationState, navigationCubit] = useBloc(NavigationCubit);
  const [clipboardState, clipboardCubit] = useBloc(ClipboardCubit);
  const uiCubit = useBlocActions(UICubit);
  const modalsCubit = useBlocActions(ModalsCubit);
  const { showContextMenu } = useContextMenu();

  const {
    selectedImage,
    adjustments,
    libraryActivePath,
    libraryActiveAdjustments,
  } = editorState;

  const {
    imageList,
    multiSelectedPaths,
  } = libraryState;

  const {
    rootPath,
    currentFolderPath,
  } = navigationState;

  const { copiedFilePaths } = clipboardState;

  const {
    handleImageSelect,
    executeDelete,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleRate,
    handleSetColorLabel,
    handleRenameFiles,
    handleResetAdjustments,
    handleLibraryRefresh,
    handleTogglePinFolder,
    handleImportClick,
    handleSelectSubfolder,
    handleTagsChanged,
    resetAdjustmentsHistory,
    undo,
    redo,
  } = handlers;

  const getCommonTags = useCallback((paths: string[]): { tag: string; isUser: boolean }[] => {
    if (paths.length === 0) return [];
    const imageFiles = imageList.filter((img) => paths.includes(img.path));
    if (imageFiles.length === 0) return [];

    const allTagsSets = imageFiles.map((img) => {
      const tagsWithPrefix = (img.tags || []).filter((t) => !t.startsWith('color:'));
      return new Set(tagsWithPrefix);
    });

    if (allTagsSets.length === 0) return [];

    const commonTagsWithPrefix = allTagsSets.reduce((intersection, currentSet) => {
      return new Set([...intersection].filter((tag) => currentSet.has(tag)));
    });

    return Array.from(commonTagsWithPrefix)
      .map((tag) => ({
        tag: tag.startsWith('user:') ? tag.substring(5) : tag,
        isUser: tag.startsWith('user:'),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, [imageList]);

  const handleEditorContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedImage) return;

    const commonTags = getCommonTags([selectedImage.path]);

    const options: Array<any> = [
      {
        label: 'Export Image',
        icon: Save,
        onClick: () => {
          editorCubit.setRenderedRightPanel(Panel.Export);
          editorCubit.setActiveRightPanel(Panel.Export);
        },
      },
      { type: OPTION_SEPARATOR },
      { label: 'Undo', icon: Undo, onClick: undo, disabled: !canUndo },
      { label: 'Redo', icon: Redo, onClick: redo, disabled: !canRedo },
      { type: OPTION_SEPARATOR },
      { label: 'Copy Adjustments', icon: Copy, onClick: handleCopyAdjustments },
      {
        label: 'Paste Adjustments',
        icon: ClipboardPaste,
        onClick: handlePasteAdjustments,
        disabled: copiedAdjustments === null,
      },
      { type: OPTION_SEPARATOR },
      { label: 'Auto Adjust Image', icon: Aperture, onClick: editorCubit.applyAutoAdjustments },
      {
        label: 'Rating',
        icon: Star,
        submenu: [0, 1, 2, 3, 4, 5].map((rating: number) => ({
          label: rating === 0 ? 'No Rating' : `${rating} Star${rating !== 1 ? 's' : ''}`,
          onClick: () => handleRate(rating),
        })),
      },
      {
        label: 'Color Label',
        icon: Palette,
        submenu: [
          { label: 'No Label', onClick: () => handleSetColorLabel(null) },
          ...COLOR_LABELS.map((label: Color) => ({
            label: label.name.charAt(0).toUpperCase() + label.name.slice(1),
            color: label.color,
            onClick: () => handleSetColorLabel(label.name),
          })),
        ],
      },
      {
        label: 'Tagging',
        icon: Tag,
        submenu: [
          {
            customComponent: TaggingSubMenu,
            customProps: {
              paths: [selectedImage.path],
              initialTags: commonTags,
              onTagsChanged: handleTagsChanged,
              appSettings,
            },
          },
        ],
      },
      { type: OPTION_SEPARATOR },
      {
        label: 'Reset Adjustments',
        icon: RotateCcw,
        onClick: () => {
          editorCubit.cancelPendingHistoryUpdate();
          const currentRating = adjustments.rating;
          resetAdjustmentsHistory({ ...INITIAL_ADJUSTMENTS, rating: currentRating, aiPatches: [] });
        },
      },
    ];
    showContextMenu(event.clientX, event.clientY, options);
  }, [
    selectedImage,
    adjustments,
    canUndo,
    canRedo,
    copiedAdjustments,
    appSettings,
    getCommonTags,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleRate,
    handleSetColorLabel,
    handleTagsChanged,
    resetAdjustmentsHistory,
    undo,
    redo,
    editorCubit,
    showContextMenu,
  ]);

  const handleThumbnailContextMenu = useCallback((event: React.MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();

    const isTargetInSelection = multiSelectedPaths.includes(path);
    let finalSelection: string[];

    if (!isTargetInSelection) {
      finalSelection = [path];
      libraryCubit.setSelection([path]);
      if (!selectedImage) {
        editorCubit.setLibraryActivePath(path);
      }
    } else {
      finalSelection = multiSelectedPaths;
    }

    const commonTags = getCommonTags(finalSelection);

    const selectionCount = finalSelection.length;
    const isSingleSelection = selectionCount === 1;
    const isEditingThisImage = selectedImage?.path === path;
    const deleteLabel = isSingleSelection ? 'Delete Image' : `Delete ${selectionCount} Images`;
    const exportLabel = isSingleSelection ? 'Export Image' : `Export ${selectionCount} Images`;

    const selectionHasVirtualCopies =
      isSingleSelection &&
      !finalSelection[0].includes('?vc=') &&
      imageList.some((image) => image.path.startsWith(`${finalSelection[0]}?vc=`));

    const hasAssociatedFiles = finalSelection.some((selectedPath) => {
      const lastDotIndex = selectedPath.lastIndexOf('.');
      if (lastDotIndex === -1) return false;
      const basePath = selectedPath.substring(0, lastDotIndex);
      return imageList.some(
        (image) => image.path.startsWith(basePath + '.') && image.path !== selectedPath,
      );
    });

    let deleteSubmenu;
    if (selectionHasVirtualCopies) {
      deleteSubmenu = [
        { label: 'Cancel', icon: X, onClick: () => {} },
        {
          label: 'Confirm Delete + Virtual Copies',
          icon: Check,
          isDestructive: true,
          onClick: () => executeDelete(finalSelection, { includeAssociated: false }),
        },
      ];
    } else if (hasAssociatedFiles) {
      deleteSubmenu = [
        { label: 'Cancel', icon: X, onClick: () => {} },
        {
          label: 'Delete Selected Only',
          icon: Check,
          isDestructive: true,
          onClick: () => executeDelete(finalSelection, { includeAssociated: false }),
        },
        {
          label: 'Delete + Associated',
          icon: Check,
          isDestructive: true,
          onClick: () => executeDelete(finalSelection, { includeAssociated: true }),
        },
      ];
    } else {
      deleteSubmenu = [
        { label: 'Cancel', icon: X, onClick: () => {} },
        {
          label: 'Confirm',
          icon: Check,
          isDestructive: true,
          onClick: () => executeDelete(finalSelection, { includeAssociated: false }),
        },
      ];
    }

    const deleteOption = {
      label: deleteLabel,
      icon: Trash2,
      isDestructive: true,
      submenu: deleteSubmenu,
    };

    const pasteLabel = isSingleSelection ? 'Paste Adjustments' : `Paste Adjustments to ${selectionCount} Images`;
    const resetLabel = isSingleSelection ? 'Reset Adjustments' : `Reset Adjustments on ${selectionCount} Images`;
    const copyLabel = isSingleSelection ? 'Copy Image' : `Copy ${selectionCount} Images`;
    const autoAdjustLabel = isSingleSelection ? 'Auto Adjust Image' : `Auto Adjust ${selectionCount} Images`;
    const renameLabel = isSingleSelection ? 'Rename Image' : `Rename ${selectionCount} Images`;
    const cullLabel = isSingleSelection ? 'Cull Image' : `Cull ${selectionCount} Images`;
    const collageLabel = 'Create Collage';
    const stitchLabel = 'Stitch Panorama';

    const handleCreateVirtualCopy = async (sourcePath: string) => {
      try {
        await invoke(Invokes.CreateVirtualCopy, { sourceVirtualPath: sourcePath });
        handleLibraryRefresh();
      } catch (err) {
        console.error('Failed to create virtual copy:', err);
        editorCubit.setError(`Failed to create virtual copy: ${err}`);
      }
    };

    const handleApplyAutoAdjustmentsToSelection = () => {
      if (finalSelection.length === 0) return;

      invoke(Invokes.ApplyAutoAdjustmentsToPaths, { paths: finalSelection })
        .then(async () => {
          if (selectedImage && finalSelection.includes(selectedImage.path)) {
            const metadata: Metadata = await invoke(Invokes.LoadMetadata, { path: selectedImage.path });
            if (metadata.adjustments && !metadata.adjustments.is_null) {
              const normalized = normalizeLoadedAdjustments(metadata.adjustments);
              resetAdjustmentsHistory(normalized);
            }
          }
          if (libraryActivePath && finalSelection.includes(libraryActivePath)) {
            const metadata: Metadata = await invoke(Invokes.LoadMetadata, { path: libraryActivePath });
            if (metadata.adjustments && !metadata.adjustments.is_null) {
              const normalized = normalizeLoadedAdjustments(metadata.adjustments);
              editorCubit.setLibraryActiveAdjustments(normalized);
            }
          }
        })
        .catch((err) => {
          console.error('Failed to apply auto adjustments to paths:', err);
          editorCubit.setError(`Failed to apply auto adjustments: ${err}`);
        });
    };

    const onExportClick = () => {
      if (selectedImage) {
        if (selectedImage.path !== path) {
          handleImageSelect(path);
        }
        editorCubit.setRenderedRightPanel(Panel.Export);
        editorCubit.setActiveRightPanel(Panel.Export);
      } else {
        uiCubit.setIsLibraryExportPanelVisible(true);
      }
    };

    const handleCopyFromThumbnail = async () => {
      try {
        const metadata: any = await invoke(Invokes.LoadMetadata, { path: finalSelection[0] });
        const sourceAdjustments =
          metadata.adjustments && !metadata.adjustments.is_null
            ? { ...INITIAL_ADJUSTMENTS, ...metadata.adjustments }
            : INITIAL_ADJUSTMENTS;
        const adjustmentsToCopy: any = {};
        for (const key of COPYABLE_ADJUSTMENT_KEYS) {
          if (sourceAdjustments.hasOwnProperty(key)) adjustmentsToCopy[key] = sourceAdjustments[key];
        }
        editorCubit.setCopiedAdjustments(adjustmentsToCopy);
        clipboardCubit.showCopiedFeedback();
      } catch (err) {
        console.error('Failed to load metadata for copy:', err);
        editorCubit.setError(`Failed to copy adjustments: ${err}`);
      }
    };

    const menuOptions = [
      ...(!isEditingThisImage
        ? [
            {
              disabled: !isSingleSelection,
              icon: Edit,
              label: 'Edit Image',
              onClick: () => handleImageSelect(finalSelection[0]),
            },
            {
              icon: Save,
              label: exportLabel,
              onClick: onExportClick,
            },
            { type: OPTION_SEPARATOR },
          ]
        : [
            {
              icon: Save,
              label: exportLabel,
              onClick: onExportClick,
            },
            { type: OPTION_SEPARATOR },
          ]),
      {
        disabled: !isSingleSelection,
        icon: Copy,
        label: 'Copy Adjustments',
        onClick: handleCopyFromThumbnail,
      },
      {
        disabled: copiedAdjustments === null,
        icon: ClipboardPaste,
        label: pasteLabel,
        onClick: handlePasteAdjustments,
      },
      {
        label: 'Productivity',
        icon: Gauge,
        submenu: [
          {
            label: autoAdjustLabel,
            icon: Aperture,
            onClick: handleApplyAutoAdjustmentsToSelection,
          },
          {
            disabled: !isSingleSelection,
            icon: CopyPlus,
            label: 'Create Virtual Copy',
            onClick: () => handleCreateVirtualCopy(finalSelection[0]),
          },
          {
            label: 'Denoise',
            icon: Grip,
            disabled: !isSingleSelection,
            onClick: () => {
              modalsCubit.openDenoise(finalSelection[0]);
            },
          },
          {
            disabled: selectionCount < 2 || selectionCount > 30,
            icon: Images,
            label: stitchLabel,
            onClick: () => {
              modalsCubit.openPanorama(finalSelection);
              modalsCubit.updatePanoramaProgress('Starting panorama process...');
              invoke(Invokes.StitchPanorama, { paths: finalSelection }).catch((err) => {
                modalsCubit.setPanoramaError(String(err));
              });
            },
          },
          {
            icon: LayoutTemplate,
            label: collageLabel,
            onClick: () => {
              const imagesForCollage = imageList.filter((img) => finalSelection.includes(img.path));
              modalsCubit.openCollage(imagesForCollage);
            },
            disabled: selectionCount === 0 || selectionCount > 9,
          },
          {
            label: cullLabel,
            icon: Users,
            onClick: () => modalsCubit.openCulling(finalSelection),
            disabled: imageList.length < 2,
          },
        ],
      },
      { type: OPTION_SEPARATOR },
      {
        label: copyLabel,
        icon: Copy,
        onClick: () => {
          clipboardCubit.setCopiedFilePaths(finalSelection);
          clipboardCubit.showCopiedFeedback();
        },
      },
      {
        disabled: !isSingleSelection,
        icon: CopyPlus,
        label: 'Duplicate Image',
        onClick: async () => {
          try {
            await invoke(Invokes.DuplicateFile, { path: finalSelection[0] });
            handleLibraryRefresh();
          } catch (err) {
            console.error('Failed to duplicate file:', err);
            editorCubit.setError(`Failed to duplicate file: ${err}`);
          }
        },
      },
      { icon: FileEdit, label: renameLabel, onClick: () => handleRenameFiles(finalSelection) },
      { type: OPTION_SEPARATOR },
      {
        icon: Star,
        label: 'Rating',
        submenu: [0, 1, 2, 3, 4, 5].map((rating: number) => ({
          label: rating === 0 ? 'No Rating' : `${rating} Star${rating !== 1 ? 's' : ''}`,
          onClick: () => handleRate(rating, finalSelection),
        })),
      },
      {
        label: 'Color Label',
        icon: Palette,
        submenu: [
          { label: 'No Label', onClick: () => handleSetColorLabel(null, finalSelection) },
          ...COLOR_LABELS.map((label: Color) => ({
            label: label.name.charAt(0).toUpperCase() + label.name.slice(1),
            color: label.color,
            onClick: () => handleSetColorLabel(label.name, finalSelection),
          })),
        ],
      },
      {
        label: 'Tagging',
        icon: Tag,
        submenu: [
          {
            customComponent: TaggingSubMenu,
            customProps: {
              paths: finalSelection,
              initialTags: commonTags,
              onTagsChanged: handleTagsChanged,
              appSettings,
            },
          },
        ],
      },
      { type: OPTION_SEPARATOR },
      {
        disabled: !isSingleSelection,
        icon: Folder,
        label: 'Show in File Explorer',
        onClick: () => {
          invoke(Invokes.ShowInFinder, { path: finalSelection[0] }).catch((err) =>
            editorCubit.setError(`Could not show file in explorer: ${err}`),
          );
        },
      },
      { label: resetLabel, icon: RotateCcw, onClick: () => handleResetAdjustments(finalSelection) },
      deleteOption,
    ];
    showContextMenu(event.clientX, event.clientY, menuOptions);
  }, [
    selectedImage,
    libraryActivePath,
    multiSelectedPaths,
    imageList,
    copiedAdjustments,
    appSettings,
    getCommonTags,
    handleImageSelect,
    executeDelete,
    handlePasteAdjustments,
    handleRate,
    handleSetColorLabel,
    handleRenameFiles,
    handleResetAdjustments,
    handleLibraryRefresh,
    handleTagsChanged,
    resetAdjustmentsHistory,
    editorCubit,
    libraryCubit,
    clipboardCubit,
    uiCubit,
    modalsCubit,
    showContextMenu,
  ]);

  const handleFolderTreeContextMenu = useCallback((event: React.MouseEvent, path: string, isCurrentlyPinned?: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    const targetPath = path || rootPath;
    if (!targetPath) {
      return;
    }
    const isRoot = targetPath === rootPath;
    const numCopied = copiedFilePaths.length;
    const copyPastedLabel = numCopied === 1 ? 'Copy image here' : `Copy ${numCopied} images here`;
    const movePastedLabel = numCopied === 1 ? 'Move image here' : `Move ${numCopied} images here`;

    const pinOption = isCurrentlyPinned
      ? {
          icon: PinOff,
          label: 'Unpin Folder',
          onClick: () => handleTogglePinFolder(targetPath),
        }
      : {
          icon: Pin,
          label: 'Pin Folder',
          onClick: () => handleTogglePinFolder(targetPath),
        };

    const menuOptions = [
      pinOption,
      { type: OPTION_SEPARATOR },
      {
        icon: FolderPlus,
        label: 'New Folder',
        onClick: () => {
          modalsCubit.openCreateFolder(targetPath);
        },
      },
      {
        disabled: isRoot,
        icon: FileEdit,
        label: 'Rename Folder',
        onClick: () => {
          const currentName = targetPath.split(/[\\/]/).pop() || '';
          modalsCubit.openRenameFolder(targetPath, currentName);
        },
      },
      { type: OPTION_SEPARATOR },
      {
        disabled: copiedFilePaths.length === 0,
        icon: ClipboardPaste,
        label: 'Paste',
        submenu: [
          {
            label: copyPastedLabel,
            onClick: async () => {
              try {
                await invoke(Invokes.CopyFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                if (targetPath === currentFolderPath) handleLibraryRefresh();
              } catch (err) {
                editorCubit.setError(`Failed to copy files: ${err}`);
              }
            },
          },
          {
            label: movePastedLabel,
            onClick: async () => {
              try {
                await invoke(Invokes.MoveFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                clipboardCubit.setCopiedFilePaths([]);
                libraryCubit.clearSelection();
                navigationCubit.refreshAllFolderTrees();
                handleLibraryRefresh();
              } catch (err) {
                editorCubit.setError(`Failed to move files: ${err}`);
              }
            },
          },
        ],
      },
      { icon: FolderInput, label: 'Import Images', onClick: () => handleImportClick(targetPath) },
      { type: OPTION_SEPARATOR },
      {
        icon: Folder,
        label: 'Show in File Explorer',
        onClick: () =>
          invoke(Invokes.ShowInFinder, { path: targetPath }).catch((err) => editorCubit.setError(`Could not show folder: ${err}`)),
      },
      ...(path
        ? [
            {
              disabled: isRoot,
              icon: Trash2,
              isDestructive: true,
              label: 'Delete Folder',
              submenu: [
                { label: 'Cancel', icon: X, onClick: () => {} },
                {
                  label: 'Confirm',
                  icon: Check,
                  isDestructive: true,
                  onClick: async () => {
                    try {
                      await invoke(Invokes.DeleteFolder, { path: targetPath });
                      if (currentFolderPath?.startsWith(targetPath)) await handleSelectSubfolder(rootPath!);
                      navigationCubit.refreshAllFolderTrees();
                    } catch (err) {
                      editorCubit.setError(`Failed to delete folder: ${err}`);
                    }
                  },
                },
              ],
            },
          ]
        : []),
    ];
    showContextMenu(event.clientX, event.clientY, menuOptions);
  }, [
    rootPath,
    currentFolderPath,
    copiedFilePaths,
    handleTogglePinFolder,
    handleImportClick,
    handleSelectSubfolder,
    handleLibraryRefresh,
    editorCubit,
    libraryCubit,
    navigationCubit,
    clipboardCubit,
    modalsCubit,
    showContextMenu,
  ]);

  const handleMainLibraryContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const numCopied = copiedFilePaths.length;
    const copyPastedLabel = numCopied === 1 ? 'Copy image here' : `Copy ${numCopied} images here`;
    const movePastedLabel = numCopied === 1 ? 'Move image here' : `Move ${numCopied} images here`;

    const menuOptions = [
      {
        label: 'Paste',
        icon: ClipboardPaste,
        disabled: copiedFilePaths.length === 0,
        submenu: [
          {
            label: copyPastedLabel,
            onClick: async () => {
              try {
                await invoke(Invokes.CopyFiles, { sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
                handleLibraryRefresh();
              } catch (err) {
                editorCubit.setError(`Failed to copy files: ${err}`);
              }
            },
          },
          {
            label: movePastedLabel,
            onClick: async () => {
              try {
                await invoke(Invokes.MoveFiles, { sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
                clipboardCubit.setCopiedFilePaths([]);
                libraryCubit.clearSelection();
                navigationCubit.refreshAllFolderTrees();
                handleLibraryRefresh();
              } catch (err) {
                editorCubit.setError(`Failed to move files: ${err}`);
              }
            },
          },
        ],
      },
      {
        icon: FolderInput,
        label: 'Import Images',
        onClick: () => handleImportClick(currentFolderPath as string),
        disabled: !currentFolderPath,
      },
    ];
    showContextMenu(event.clientX, event.clientY, menuOptions);
  }, [
    currentFolderPath,
    copiedFilePaths,
    handleImportClick,
    handleLibraryRefresh,
    editorCubit,
    libraryCubit,
    navigationCubit,
    clipboardCubit,
    showContextMenu,
  ]);

  return {
    handleEditorContextMenu,
    handleThumbnailContextMenu,
    handleFolderTreeContextMenu,
    handleMainLibraryContextMenu,
  };
}
