import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import debounce from 'lodash.debounce';
import { ClerkProvider } from '@clerk/clerk-react';
import { useBloc } from '@blac/react';
import clsx from 'clsx';
import {
  ModalsCubit,
  SettingsCubit,
  NavigationCubit,
  LibraryCubit,
  EditorCubit,
  MasksCubit,
  FolderNode,
  UICubit,
  ExportImportCubit,
  ClipboardCubit,
  IndexingCubit,
  ComfyUICubit,
} from './cubits';

import TitleBar from './window/TitleBar';
import CommunityPage from './components/panel/CommunityPage';
import MainLibrary from './components/panel/MainLibrary';
import LeftPanelContainer from './components/layout/LeftPanelContainer';
import Editor from './components/panel/Editor';
import { useThumbnails } from './hooks/useThumbnails';
import { ImageDimensions } from './hooks/useImageRenderSize';
import RightPanelContainer from './components/layout/RightPanelContainer';
import LibraryExportPanel from './components/panel/right/LibraryExportPanel';
import BottomBar from './components/panel/BottomBar';
import { ContextMenuProvider } from './context/ContextMenuContext';
import CreateFolderModal from './components/modals/CreateFolderModal';
import RenameFolderModal from './components/modals/RenameFolderModal';
import ConfirmModal from './components/modals/ConfirmModal';
import ImportSettingsModal from './components/modals/ImportSettingsModal';
import RenameFileModal from './components/modals/RenameFileModal';
import PanoramaModal from './components/modals/PanoramaModal';
import DenoiseModal from './components/modals/DenoiseModal';
import CollageModal from './components/modals/CollageModal';
import CopyPasteSettingsModal from './components/modals/CopyPasteSettingsModal';
import CullingModal from './components/modals/CullingModal';

import Resizer from './components/ui/Resizer';
import {
  Adjustments,
  AiPatch,
  Color,
  COLOR_LABELS,
  Coord,
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
  MaskContainer,
  normalizeLoadedAdjustments,
  PasteMode,
  CopyPasteSettings,
} from './utils/adjustments';
import { generatePaletteFromImage } from './utils/palette';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useContextMenus } from './hooks/useContextMenus';
import { THEMES, DEFAULT_THEME_ID, ThemeProps } from './utils/themes';
import { SubMask } from './components/panel/right/Masks';
import {
  ExportState,
  IMPORT_TIMEOUT,
  ImportState,
  Status,
} from './components/panel/right/ExportImportProperties';
import {
  AppSettings,
  Invokes,
  ImageFile,
  LibraryViewMode,
  Panel,
  Progress,
  RawStatus,
  SupportedTypes,
  Theme,
  TransformState,
  Orientation,
  ThumbnailSize,
  ThumbnailAspectRatio,
} from './components/ui/AppProperties';


const CLERK_PUBLISHABLE_KEY = 'pk_test_YnJpZWYtc2Vhc25haWwtMTIuY2xlcmsuYWNjb3VudHMuZGV2JA'; // local dev key



interface Metadata {
  adjustments: Adjustments;
  rating: number;
  tags: Array<string> | null;
  version: number;
}

interface MultiSelectOptions {
  onSimpleClick(p: any): void;
  updateLibraryActivePath: boolean;
  shiftAnchor: string | null;
}









interface LutData {
  size: number;
}

interface SearchCriteria {
  tags: string[];
  text: string;
  mode: 'AND' | 'OR';
}

const DEBUG = false;
const REVOCATION_DELAY = 5000;

const useDelayedRevokeBlobUrl = (url: string | null | undefined) => {
  const previousUrlRef = useRef<string | null | undefined>(null);

  useEffect(() => {
    if (previousUrlRef.current && previousUrlRef.current !== url) {
      const urlToRevoke = previousUrlRef.current;
      if (urlToRevoke && urlToRevoke.startsWith('blob:')) {
        setTimeout(() => {
          URL.revokeObjectURL(urlToRevoke);
        }, REVOCATION_DELAY);
      }
    }
    previousUrlRef.current = url;
  }, [url]);

  useEffect(() => {
    return () => {
      const finalUrl = previousUrlRef.current;
      if (finalUrl && finalUrl.startsWith('blob:')) {
        URL.revokeObjectURL(finalUrl);
      }
    };
  }, []);
};

const getParentDir = (filePath: string): string => {
  const separator = filePath.includes('/') ? '/' : '\\';
  const lastSeparatorIndex = filePath.lastIndexOf(separator);
  if (lastSeparatorIndex === -1) {
    return '';
  }
  return filePath.substring(0, lastSeparatorIndex);
};

function App() {
  const [modalsState, modalsCubit] = useBloc(ModalsCubit);
  const [settingsState, settingsCubit] = useBloc(SettingsCubit);
  const [navigationState, navigationCubit] = useBloc(NavigationCubit);
  const [libraryState, libraryCubit] = useBloc(LibraryCubit);
  const [editorState, editorCubit] = useBloc(EditorCubit);
  const [masksState, masksCubit] = useBloc(MasksCubit);
  const [uiState, uiCubit] = useBloc(UICubit);
  const [exportImportState, exportImportCubit] = useBloc(ExportImportCubit);
  const [clipboardState, clipboardCubit] = useBloc(ClipboardCubit);
  const [indexingState, indexingCubit] = useBloc(IndexingCubit);
  const [comfyUIState, comfyUICubit] = useBloc(ComfyUICubit);

  // Destructure commonly used state from LibraryCubit (early for useThumbnails)
  const {
    imageList,
    imageRatings,
    thumbnails,
    multiSelectedPaths,
    sortCriteria,
    filterCriteria,
    searchCriteria,
  } = libraryState;

  // Navigation state from NavigationCubit - single source of truth
  const {
    rootPath,
    currentFolderPath,
    expandedFolders,
    folderTree,
    pinnedFolderTrees,
    pinnedFolders,
    activeTreeSection,
    isTreeLoading,
    activeView,
    libraryViewMode,
  } = navigationState;

  // Settings state from SettingsCubit - single source of truth
  const { theme, appSettings } = settingsState;

  const [isWindowFullScreen, setIsWindowFullScreen] = useState(false);
  const [supportedTypes, setSupportedTypes] = useState<SupportedTypes | null>(null);

  // Editor state from EditorCubit - single source of truth
  const {
    selectedImage,
    adjustments,
    zoom,
    displaySize,
    previewSize,
    baseRenderSize,
    originalSize,
    showOriginal,
    isFullScreen,
    isFullScreenLoading,
    isAdjusting,
    isLoadingFullRes,
    isFullResolution,
    isViewLoading,
    copiedSectionAdjustments,
    activeRightPanel,
    renderedRightPanel,
    isStraightenActive,
    isWbPickerActive,
    finalPreviewUrl,
    uncroppedAdjustedPreviewUrl,
    fullScreenUrl,
    fullResolutionUrl,
    transformedOriginalUrl,
    histogram,
    waveform,
    isWaveformVisible,
    collapsibleSectionsState,
    error,
    libraryActivePath,
    libraryActiveAdjustments,
    initialFitScale,
  } = editorState;

  // Computed getters from EditorCubit
  const canUndo = editorCubit.canUndo;
  const canRedo = editorCubit.canRedo;

  // Wrapper setters that delegate to EditorCubit methods (for backward compatibility)
  const setError = editorCubit.setError;
  const setSelectedImage = editorCubit.setSelectedImage;
  const setShowOriginal = editorCubit.setShowOriginal;
  const setIsFullScreen = editorCubit.setIsFullScreen;
  const setIsFullScreenLoading = editorCubit.setIsFullScreenLoading;
  const setIsAdjusting = editorCubit.setIsAdjusting;
  const setIsLoadingFullRes = editorCubit.setIsLoadingFullRes;
  const setIsFullResolution = editorCubit.setIsFullResolution;
  const setIsViewLoading = editorCubit.setIsViewLoading;
  const setActiveRightPanel = editorCubit.setActiveRightPanel;
  const setRenderedRightPanel = editorCubit.setRenderedRightPanel;
  const setFinalPreviewUrl = editorCubit.setFinalPreviewUrl;
  const setUncroppedAdjustedPreviewUrl = editorCubit.setUncroppedAdjustedPreviewUrl;
  const setFullScreenUrl = editorCubit.setFullScreenUrl;
  const setFullResolutionUrl = editorCubit.setFullResolutionUrl;
  const setTransformedOriginalUrl = editorCubit.setTransformedOriginalUrl;
  const setHistogram = editorCubit.setHistogram;
  const setWaveform = editorCubit.setWaveform;
  const setIsWaveformVisible = editorCubit.setIsWaveformVisible;
  const setLibraryActivePath = editorCubit.setLibraryActivePath;
  const setLibraryActiveAdjustments = editorCubit.setLibraryActiveAdjustments;
  const setInitialFitScale = editorCubit.setInitialFitScale;
  const setZoom = editorCubit.setZoom;
  const setOriginalSize = editorCubit.setOriginalSize;
  const setPreviewSize = editorCubit.setPreviewSize;
  const resetAdjustmentsHistory = editorCubit.resetHistory;
  const setIsWbPickerActive = editorCubit.setIsWbPickerActive;

  // For callback-style setSelectedImage updates
  const updateSelectedImage = editorCubit.updateSelectedImage;

  // Delegate to EditorCubit


  const [initialFileToOpen, setInitialFileToOpen] = useState<string | null>(null);
  // uiVisibility is derived from appSettings (SettingsCubit is single source of truth)
  const uiVisibility = appSettings?.uiVisibility ?? { folderTree: true, filmstrip: true };
  const [isAnimatingTheme, setIsAnimatingTheme] = useState(false);
  const isInitialThemeMount = useRef(true);
  const [adaptivePalette, setAdaptivePalette] = useState<any>(null);
  // Masks state from MasksCubit - single source of truth
  const {
    activeMaskContainerId,
    activeMaskId,
    activeAiPatchContainerId,
    activeAiSubMaskId,
    brushSettings,
    isGeneratingAiMask,
    isMaskControlHovered,
  } = masksState;
  const fullResRequestRef = useRef<any>(null);
  const fullResCacheKeyRef = useRef<string | null>(null);

  // NOTE: Blob URLs are now managed by EditorCubit.clearSelectedImage()
  // useDelayedRevokeBlobUrl hooks removed - cubit handles cleanup

  // UI state from UICubit - single source of truth
  const {
    rightPanelWidth,
    bottomPanelHeight,
    isResizing,
    isLibraryExportPanelVisible,
    libraryScrollTop,
  } = uiState;

  // Export/Import state from ExportImportCubit - single source of truth
  const { export: exportState, import: importState } = exportImportState;

  // Clipboard state from ClipboardCubit - single source of truth
  const {
    copiedFilePaths,
    copiedAdjustments,
    isCopied,
    isPasted,
  } = clipboardState;

  // Indexing state from IndexingCubit - single source of truth
  const { isIndexing, progress: indexingProgress } = indexingState;

  // ComfyUI state from ComfyUICubit - single source of truth
  const {
    isConnected: isComfyUiConnected,
    isGenerating: isGeneratingAi,
    modelDownloadStatus: aiModelDownloadStatus,
  } = comfyUIState;

  // thumbnailSize and thumbnailAspectRatio derived from appSettings (SettingsCubit is single source of truth)
  const thumbnailSize = appSettings?.thumbnailSize ?? ThumbnailSize.Medium;
  const thumbnailAspectRatio = appSettings?.thumbnailAspectRatio ?? ThumbnailAspectRatio.Cover;

  // copiedMask now comes from MasksCubit
  const { copiedMask } = masksState;

  // NOTE: brushSettings, isGeneratingAiMask, isMaskControlHovered now come from MasksCubit

  // Wrapper setters for backward compatibility (delegate to cubits)
  const setIsLibraryExportPanelVisible = uiCubit.setIsLibraryExportPanelVisible;
  const setLibraryScrollTop = uiCubit.setLibraryScrollTop;

  const setExportState = (state: Partial<ExportState> | ((prev: ExportState) => ExportState)) => {
    if (typeof state === 'function') {
      const newState = state(exportState);
      exportImportCubit.setExportState(newState);
    } else {
      exportImportCubit.setExportState(state);
    }
  };

  const setImportState = (state: Partial<ImportState> | ((prev: ImportState) => ImportState)) => {
    if (typeof state === 'function') {
      const newState = state(importState);
      exportImportCubit.setImportState(newState);
    } else {
      exportImportCubit.setImportState(state);
    }
  };

  const setCopiedFilePaths = clipboardCubit.setCopiedFilePaths;

  const setIsGeneratingAi = comfyUICubit.setIsGenerating;

  const [customEscapeHandler, setCustomEscapeHandler] = useState(null);
  const { loading: isThumbnailsLoading } = useThumbnails(imageList, (updater: any) => {
    if (typeof updater === 'function') {
      libraryCubit.update((state) => ({
        ...state,
        thumbnails: updater(state.thumbnails),
      }));
    } else {
      libraryCubit.setThumbnails(updater);
    }
  });
  const transformWrapperRef = useRef<any>(null);
  const isProgrammaticZoom = useRef(false);
  const isInitialMount = useRef(true);
  const currentFolderPathRef = useRef<string>(currentFolderPath);

  useEffect(() => {
    currentFolderPathRef.current = currentFolderPath;
  }, [currentFolderPath]);

  // NOTE: isCopied/isPasted feedback timers are now handled by ClipboardCubit

  // setAdjustments wraps EditorCubit.setAdjustments
  const setAdjustments = editorCubit.setAdjustments;

  // Delegate to EditorCubit.applyStraighten


  // No-op callback for white balance picker (keeps picker active after use)


  useEffect(() => {
    if (
      (activeRightPanel !== Panel.Masks || !activeMaskContainerId) &&
      (activeRightPanel !== Panel.Ai || !activeAiPatchContainerId)
    ) {
      masksCubit.setIsMaskControlHovered(false);
    }
  }, [activeRightPanel, activeMaskContainerId, activeAiPatchContainerId, masksCubit]);

  // Computed keys from EditorCubit for tracking adjustment changes
  const geometricAdjustmentsKey = editorCubit.geometricAdjustmentsKey;
  const visualAdjustmentsKey = editorCubit.visualAdjustmentsKey;

  const undo = useCallback(() => {
    if (canUndo) {
      editorCubit.undo();
    }
  }, [canUndo, editorCubit]);
  const redo = useCallback(() => {
    if (canRedo) {
      editorCubit.redo();
    }
  }, [canRedo, editorCubit]);

  useEffect(() => {
    setTransformedOriginalUrl(null);
  }, [geometricAdjustmentsKey, selectedImage?.path]);

  useEffect(() => {
    let isEffectActive = true;
    let objectUrl: string | null = null;

    const generate = async () => {
      if (showOriginal && selectedImage?.path && !transformedOriginalUrl) {
        try {
          const imageData: Uint8Array = await invoke('generate_original_transformed_preview', {
            jsAdjustments: adjustments,
          });
          if (isEffectActive) {
            const blob = new Blob([imageData], { type: 'image/jpeg' });
            objectUrl = URL.createObjectURL(blob);
            setTransformedOriginalUrl(objectUrl);
          }
        } catch (e) {
          if (isEffectActive) {
            console.error('Failed to generate original preview:', e);
            setError('Failed to show original image.');
            setShowOriginal(false);
          }
        }
      }
    };

    generate();

    return () => {
      isEffectActive = false;
    };
  }, [showOriginal, selectedImage?.path, adjustments, transformedOriginalUrl]);

  useEffect(() => {
    if (currentFolderPath) {
      refreshImageList();
    }
  }, [libraryViewMode]);

  // Note: ComfyUI status polling is handled by ComfyUICubit (in constructor)

  // Delegate to EditorCubit


  const handleGenerativeReplace = useCallback(
    async (patchId: string, prompt: string, useFastInpaint: boolean) => {
      await comfyUICubit.generativeReplace(patchId, prompt, useFastInpaint, editorCubit, masksCubit);
    },
    [comfyUICubit, editorCubit, masksCubit],
  );

  const handleQuickErase = useCallback(
    async (subMaskId: string | null, startPoint: Coord, endPoint: Coord) => {
      await comfyUICubit.quickErase(subMaskId, startPoint, endPoint, editorCubit, masksCubit);
    },
    [comfyUICubit, editorCubit, masksCubit],
  );

  const handleDeleteMaskContainer = useCallback(
    (containerId: string) => {
      editorCubit.deleteMaskContainer(containerId);
      if (activeMaskContainerId === containerId) {
        masksCubit.clearActiveMask();
      }
    },
    [editorCubit, activeMaskContainerId, masksCubit],
  );

  const handleDeleteAiPatch = useCallback(
    (patchId: string) => {
      editorCubit.deleteAiPatch(patchId);
      if (activeAiPatchContainerId === patchId) {
        masksCubit.clearActiveAiPatch();
      }
    },
    [editorCubit, activeAiPatchContainerId, masksCubit],
  );

  // Delegate to EditorCubit
  const handleToggleAiPatchVisibility = editorCubit.toggleAiPatchVisibility;

  // Delegate AI mask generation to MasksCubit (with editorCubit context)
  const handleGenerateAiMask = (subMaskId: string, startPoint: Coord, endPoint: Coord) => {
    masksCubit.generateAiMask(subMaskId, startPoint, endPoint, editorCubit as unknown as EditorCubit);
  };

  const handleGenerateAiForegroundMask = (subMaskId: string) => {
    masksCubit.generateAiForegroundMask(subMaskId, editorCubit as unknown as EditorCubit);
  };

  const handleGenerateAiSkyMask = (subMaskId: string) => {
    masksCubit.generateAiSkyMask(subMaskId, editorCubit as unknown as EditorCubit);
  };

  // Sorted/filtered image list from LibraryCubit
  const sortedImageList = libraryCubit.sortedImageList;

  const applyAdjustments = useCallback(
    debounce((currentAdjustments) => {
      if (!selectedImage?.isReady) {
        return;
      }
      setIsAdjusting(true);
      invoke(Invokes.ApplyAdjustments, { jsAdjustments: currentAdjustments }).catch((err) => {
        console.error('Failed to invoke apply_adjustments:', err);
        setError(`Processing failed: ${err}`);
        setIsAdjusting(false);
      });
    }, 50),
    [selectedImage?.isReady],
  );

  const debouncedGenerateUncroppedPreview = useCallback(
    debounce((currentAdjustments) => {
      if (!selectedImage?.isReady) {
        return;
      }
      invoke(Invokes.GenerateUncroppedPreview, { jsAdjustments: currentAdjustments }).catch((err) =>
        console.error('Failed to generate uncropped preview:', err),
      );
    }, 50),
    [selectedImage?.isReady],
  );

  const debouncedSave = useCallback(
    debounce((path, adjustmentsToSave) => {
      invoke(Invokes.SaveMetadataAndUpdateThumbnail, { path, adjustments: adjustmentsToSave }).catch((err) => {
        console.error('Auto-save failed:', err);
        setError(`Failed to save changes: ${err}`);
      });
    }, 300),
    [],
  );

  // Resize handlers - delegate to UICubit
  const createResizeHandler = uiCubit.createResizeHandler;

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const checkFullscreen = async () => {
      setIsWindowFullScreen(await appWindow.isFullscreen());
    };
    checkFullscreen();

    const unlistenPromise = appWindow.onResized(checkFullscreen);

    return () => {
      unlistenPromise.then((unlisten: any) => unlisten());
    };
  }, []);

  const handleRightPanelSelect = useCallback(
    (panelId: Panel) => {
      if (panelId === activeRightPanel) {
        setActiveRightPanel(null);
      } else {
        setActiveRightPanel(panelId);
        setRenderedRightPanel(panelId);
      }
      masksCubit.setActiveMask(null);
      masksCubit.setActiveAiSubMask(null);
    },
    [activeRightPanel, masksCubit],
  );

  const handleSettingsChange = useCallback(
    (newSettings: AppSettings) => {
      if (!newSettings) {
        console.error('handleSettingsChange was called with null settings. Aborting save operation.');
        return;
      }
      if (newSettings.theme && newSettings.theme !== theme) {
        settingsCubit.setTheme(newSettings.theme);
      }
      // Update the cubit - this will auto-save via debounced stateChanged event
      settingsCubit.updateAppSettings(newSettings);
    },
    [theme, settingsCubit],
  );

  // Initialize SettingsCubit on mount
  useEffect(() => {
    settingsCubit.loadSettings();
  }, [settingsCubit]);

  // Setup event listeners for cubits
  useEffect(() => {
    editorCubit.setupEventListeners();
    exportImportCubit.setupEventListeners();
    indexingCubit.setupEventListeners();
    libraryCubit.setupEventListeners();
    modalsCubit.setupEventListeners();
    // Note: ComfyUICubit sets up its own listeners in constructor (including ai-model-download events)

    // Set callbacks for cubit events
    indexingCubit.setOnIndexingFinished(() => {
      if (currentFolderPathRef.current) {
        invoke(Invokes.ListImagesInDir, { path: currentFolderPathRef.current })
          .then((list: any) => {
            if (Array.isArray(list)) {
              libraryCubit.setImageList(list);
            }
          })
          .catch((err) => console.error('Failed to refresh after indexing:', err));
      }
    });

    exportImportCubit.setOnImportComplete(() => {
      refreshAllFolderTrees();
      if (currentFolderPathRef.current) {
        handleSelectSubfolder(currentFolderPathRef.current, false);
      }
    });

    return () => {
      editorCubit.disposeEventListeners();
      exportImportCubit.dispose();
      indexingCubit.dispose();
      libraryCubit.dispose();
      modalsCubit.dispose();
    };
  }, [editorCubit, exportImportCubit, indexingCubit, libraryCubit, modalsCubit]);



  // React to settingsState.isLoaded to sync other cubits and initialize app
  useEffect(() => {
    if (!settingsState.isLoaded) return;

    const settings = settingsState.appSettings;

    // Sync to LibraryCubit
    if (settings?.sortCriteria) libraryCubit.setSortCriteria(settings.sortCriteria);
    if (settings?.filterCriteria) {
      libraryCubit.setFilterCriteria({
        ...settings.filterCriteria,
        rawStatus: settings.filterCriteria.rawStatus || RawStatus.All,
        colors: settings.filterCriteria.colors || [],
      });
    }

    // Sync to NavigationCubit
    if (settings?.activeTreeSection) {
      navigationCubit.setActiveTreeSection(settings.activeTreeSection);
    }
    if (settings?.pinnedFolders && settings.pinnedFolders.length > 0) {
      navigationCubit.setPinnedFolders(settings.pinnedFolders);
      invoke<FolderNode[]>(Invokes.GetPinnedFolderTrees, { paths: settings.pinnedFolders })
        .then((trees) => {
          navigationCubit.setPinnedFolderTrees(trees);
        })
        .catch((err) => {
          console.error('Failed to load pinned folder trees:', err);
        });
    }

    // Notify backend that frontend is ready
    invoke('frontend_ready').catch(e => console.error("Failed to notify backend of readiness:", e));

    isInitialMount.current = false;
  }, [settingsState.isLoaded]);

  // NOTE: Removed uiVisibility sync useEffect - now derived from appSettings (SettingsCubit)

  const handleToggleWaveform = useCallback(() => {
    editorCubit.toggleWaveform();
  }, [editorCubit]);

  // NOTE: Removed thumbnailSize and thumbnailAspectRatio sync useEffects - now derived from appSettings (SettingsCubit)

  useEffect(() => {
    invoke(Invokes.GetSupportedFileTypes)
      .then((types: any) => setSupportedTypes(types))
      .catch((err) => console.error('Failed to load supported file types:', err));
  }, []);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) {
      return;
    }
    if (JSON.stringify(appSettings.sortCriteria) !== JSON.stringify(sortCriteria)) {
      handleSettingsChange({ ...appSettings, sortCriteria });
    }
  }, [sortCriteria, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings) {
      return;
    }
    if (JSON.stringify(appSettings.filterCriteria) !== JSON.stringify(filterCriteria)) {
      handleSettingsChange({ ...appSettings, filterCriteria });
    }
  }, [filterCriteria, appSettings, handleSettingsChange]);

  useEffect(() => {
    if (appSettings?.adaptiveEditorTheme && selectedImage && finalPreviewUrl) {
      generatePaletteFromImage(finalPreviewUrl)
        .then(setAdaptivePalette)
        .catch((err) => {
          const darkTheme = THEMES.find((t) => t.id === Theme.Dark);
          setAdaptivePalette(darkTheme ? darkTheme.cssVariables : null);
        });
    } else if (!appSettings?.adaptiveEditorTheme || !selectedImage) {
      setAdaptivePalette(null);
    }
  }, [appSettings?.adaptiveEditorTheme, selectedImage, finalPreviewUrl]);

  useEffect(() => {
    const root = document.documentElement;
    const currentThemeId = theme || DEFAULT_THEME_ID;

    const baseTheme =
      THEMES.find((t: ThemeProps) => t.id === currentThemeId) ||
      THEMES.find((t: ThemeProps) => t.id === DEFAULT_THEME_ID);
    if (!baseTheme) {
      return;
    }

    let finalCssVariables: any = { ...baseTheme.cssVariables };
    let effectThemeForWindow = baseTheme.id;

    if (adaptivePalette) {
      finalCssVariables = { ...finalCssVariables, ...adaptivePalette };
    }

    Object.entries(finalCssVariables).forEach(([key, value]) => {
      root.style.setProperty(key, value as string);
    });

    const isLight = [Theme.Light, Theme.Snow, Theme.Arctic].includes(effectThemeForWindow);
    invoke(Invokes.UpdateWindowEffect, { theme: isLight ? Theme.Light : Theme.Dark });
  }, [theme, adaptivePalette]);

  useEffect(() => {
    if (isInitialThemeMount.current) {
      isInitialThemeMount.current = false;
      return;
    }

    setIsAnimatingTheme(true);
    const timer = setTimeout(() => setIsAnimatingTheme(false), 500);

    return () => clearTimeout(timer);
  }, [theme]);

  // Delegate to NavigationCubit
  const refreshAllFolderTrees = navigationCubit.refreshAllFolderTrees;

  const handleTogglePinFolder = useCallback(async (path: string) => {
    if (!appSettings) return;
    const isPinned = pinnedFolders.includes(path);

    // If pinning the current folder, switch to pinned section
    if (!isPinned && path === currentFolderPath) {
      handleActiveTreeSectionChange('pinned');
    }

    // Toggle pin in NavigationCubit (handles tree refresh)
    const newPins = await navigationCubit.togglePinFolder(path);

    // Persist to settings
    handleSettingsChange({ ...appSettings, pinnedFolders: newPins });
  }, [appSettings, handleSettingsChange, currentFolderPath, pinnedFolders, navigationCubit]);

  const handleActiveTreeSectionChange = (section: string | null) => {
    navigationCubit.setActiveTreeSection(section);
    if (appSettings) {
      handleSettingsChange({ ...appSettings, activeTreeSection: section });
    }
  };

  const handleSelectSubfolder = useCallback(
    async (path: string | null, isNewRoot = false) => {
      await navigationCubit.selectSubfolder(path, isNewRoot, {
        libraryCubit,
        editorCubit,
        settingsCubit,
        uiCubit,
        setIsViewLoading,
        setError,
        handleActiveTreeSectionChange,
      });
    },
    [navigationCubit, libraryCubit, editorCubit, settingsCubit, uiCubit, handleActiveTreeSectionChange],
  );

  const handleLibraryRefresh = useCallback(() => {
    if (currentFolderPath) handleSelectSubfolder(currentFolderPath, false);
  }, [currentFolderPath, handleSelectSubfolder]);

  const refreshImageList = useCallback(async () => {
    if (!currentFolderPath) return;
    try {
      const command =
        libraryViewMode === LibraryViewMode.Recursive ? Invokes.ListImagesRecursive : Invokes.ListImagesInDir;

      const files: ImageFile[] = await invoke(command, { path: currentFolderPath });
      const exifSortKeys = ['date_taken', 'iso', 'shutter_speed', 'aperture', 'focal_length'];
      const isExifSortActive = exifSortKeys.includes(sortCriteria.key);
      const shouldReadExif = appSettings?.enableExifReading ?? false;

      let freshExifData: Record<string, any> | null = null;

      if (shouldReadExif && files.length > 0 && isExifSortActive) {
        const paths = files.map((f: ImageFile) => f.path);
        freshExifData = await invoke(Invokes.ReadExifForPaths, { paths });
      }

      libraryCubit.update((state) => {
        const prevMap = new Map(state.imageList.map((img) => [img.path, img]));

        return {
          ...state,
          imageList: files.map((newFile) => {
            if (freshExifData && freshExifData[newFile.path]) {
              newFile.exif = freshExifData[newFile.path];
              return newFile;
            }
            const existing = prevMap.get(newFile.path);
            if (existing && existing.modified === newFile.modified) {
              return existing;
            }

            return newFile;
          }),
        };
      });

      if (shouldReadExif && files.length > 0 && !isExifSortActive) {
        const paths = files.map((f: ImageFile) => f.path);
        invoke(Invokes.ReadExifForPaths, { paths })
          .then((exifDataMap: any) => {
            libraryCubit.update((state) => ({
              ...state,
              imageList: state.imageList.map((image) => {
                if (exifDataMap[image.path] && !image.exif) {
                   return { ...image, exif: exifDataMap[image.path] };
                }
                return image;
              }),
            }));
          })
          .catch((err) => {
            console.error('Failed to read EXIF data in background:', err);
          });
      }
    } catch (err) {
      console.error('Failed to refresh image list:', err);
      setError('Failed to refresh image list.');
    }
  }, [currentFolderPath, sortCriteria.key, appSettings?.enableExifReading, libraryViewMode]);

  useEffect(() => {
    if (isInitialMount.current || !appSettings || !rootPath) {
      return;
    }

    const newFolderState = {
      currentFolderPath,
      expandedFolders: Array.from(expandedFolders),
    };

    if (JSON.stringify(appSettings.lastFolderState) === JSON.stringify(newFolderState)) {
      return;
    }

    handleSettingsChange({ ...appSettings, lastFolderState: newFolderState });
  }, [currentFolderPath, expandedFolders, rootPath, appSettings, handleSettingsChange]);

  useEffect(() => {
    const handleGlobalContextMenu = (event: any) => {
      if (!DEBUG) event.preventDefault();
    };
    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => window.removeEventListener('contextmenu', handleGlobalContextMenu);
  }, []);

  const handleBackToLibrary = useCallback(() => {
    const lastActivePath = selectedImage?.path ?? null;
    setSelectedImage(null);
    setFinalPreviewUrl(null);
    setUncroppedAdjustedPreviewUrl(null);
    setHistogram(null);
    setWaveform(null);
    setIsWaveformVisible(false);
    masksCubit.clearActiveMask();
    masksCubit.clearActiveAiPatch();
    setIsWbPickerActive(false);
    setLibraryActivePath(lastActivePath);
  }, [selectedImage?.path, masksCubit]);

  const handleImageSelect = useCallback(
    (path: string) => {
      applyAdjustments.cancel();
      debouncedSave.cancel();

      const selected = editorCubit.selectImage(path, thumbnails[path], masksCubit, libraryCubit);
      if (selected) {
        if (transformWrapperRef.current) {
          transformWrapperRef.current.resetTransform(0);
        }
        setIsLibraryExportPanelVisible(false);
      }
    },
    [applyAdjustments, debouncedSave, thumbnails, masksCubit, libraryCubit, editorCubit],
  );

  const executeDelete = useCallback(
    async (pathsToDelete: Array<string>, options = { includeAssociated: false }) => {
      await libraryCubit.deleteFiles(pathsToDelete, options, editorCubit, {
        refreshImageList,
        handleImageSelect,
        handleBackToLibrary,
      });
    },
    [libraryCubit, editorCubit, refreshImageList, handleImageSelect, handleBackToLibrary],
  );

  const handleDeleteSelected = useCallback(() => {
    const pathsToDelete = multiSelectedPaths;
    if (pathsToDelete.length === 0) {
      return;
    }

    const isSingle = pathsToDelete.length === 1;

    const selectionHasVirtualCopies =
      isSingle &&
      !pathsToDelete[0].includes('?vc=') &&
      imageList.some((image) => image.path.startsWith(`${pathsToDelete[0]}?vc=`));

    let modalTitle = 'Confirm Delete';
    let modalMessage = '';
    let confirmText = 'Delete';

    if (selectionHasVirtualCopies) {
      modalTitle = 'Delete Image and All Virtual Copies?';
      modalMessage = `Are you sure you want to permanently delete this image and all of its virtual copies? This action cannot be undone.`;
      confirmText = 'Delete All';
    } else if (isSingle) {
      modalMessage = `Are you sure you want to permanently delete this image? This action cannot be undone. Right-click for more options (e.g., deleting associated files).`;
      confirmText = 'Delete Selected Only';
    } else {
      modalMessage = `Are you sure you want to permanently delete these ${pathsToDelete.length} images? This action cannot be undone. Right-click for more options (e.g., deleting associated files).`;
      confirmText = 'Delete Selected Only';
    }

    modalsCubit.openConfirm({
      title: modalTitle,
      message: modalMessage,
      confirmText,
      confirmVariant: 'destructive',
      onConfirm: () => executeDelete(pathsToDelete, { includeAssociated: false }),
    });
  }, [multiSelectedPaths, executeDelete, imageList, modalsCubit]);

  const handleToggleFullScreen = useCallback(() => {
    editorCubit.toggleFullScreen();
  }, [editorCubit]);

  useEffect(() => {
    if (!isFullScreen || !selectedImage?.isReady) {
      return;
    }

    let url: string | null = null;
    const generate = async () => {
      setIsFullScreenLoading(true);
      try {
        const imageData: Uint8Array = await invoke(Invokes.GenerateFullscreenPreview, { jsAdjustments: adjustments });
        const blob = new Blob([imageData], { type: 'image/jpeg' });
        url = URL.createObjectURL(blob);
        setFullScreenUrl(url);
      } catch (e) {
        console.error('Failed to generate fullscreen preview:', e);
        setError('Failed to generate full screen preview.');
      } finally {
        setIsFullScreenLoading(false);
      }
    };
    generate();
  }, [isFullScreen, selectedImage?.path, selectedImage?.isReady, adjustments]);

  const handleCopyAdjustments = useCallback(() => {
    const sourceAdjustments = selectedImage ? adjustments : libraryActiveAdjustments;
    clipboardCubit.copyAdjustments(sourceAdjustments);
  }, [selectedImage, adjustments, libraryActiveAdjustments, clipboardCubit]);

  const handlePasteAdjustments = useCallback(
    (paths?: Array<string>) => {
      if (!copiedAdjustments || !appSettings) {
        return;
      }

      const { mode, includedAdjustments } = appSettings.copyPasteSettings;

      const adjustmentsToApply: Partial<Adjustments> = {};

      for (const key of includedAdjustments) {
        if (Object.prototype.hasOwnProperty.call(copiedAdjustments, key)) {
          const value = copiedAdjustments[key as keyof Adjustments];

          if (mode === PasteMode.Merge) {
            const defaultValue = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
            if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
              adjustmentsToApply[key as keyof Adjustments] = value;
            }
          } else {
            adjustmentsToApply[key as keyof Adjustments] = value;
          }
        }
      }

      if (Object.keys(adjustmentsToApply).length === 0) {
        clipboardCubit.showPastedFeedback();
        return;
      }

      const pathsToUpdate =
        paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
      if (pathsToUpdate.length === 0) {
        return;
      }

      if (selectedImage && pathsToUpdate.includes(selectedImage.path)) {
        const newAdjustments = { ...adjustments, ...adjustmentsToApply };
        setAdjustments(newAdjustments);
      }

      invoke(Invokes.ApplyAdjustmentsToPaths, { paths: pathsToUpdate, adjustments: adjustmentsToApply }).catch(
        (err) => {
          console.error('Failed to paste adjustments to multiple images:', err);
          setError(`Failed to paste adjustments: ${err}`);
        },
      );
      clipboardCubit.showPastedFeedback();
    },
    [copiedAdjustments, appSettings, multiSelectedPaths, selectedImage, adjustments, setAdjustments, clipboardCubit],
  );

  const handleRate = useCallback(
    (newRating: number, paths?: Array<string>) => {
      libraryCubit.rateImages(newRating, editorCubit, paths);
    },
    [libraryCubit, editorCubit],
  );

  const handleSetColorLabel = useCallback(
    (color: string | null, paths?: Array<string>) => {
      libraryCubit.setColorLabel(color, editorCubit, paths);
    },
    [libraryCubit, editorCubit],
  );

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

  const handleTagsChanged = useCallback((changedPaths: string[], newTags: { tag: string; isUser: boolean }[]) => {
    libraryCubit.updateTags(changedPaths, newTags);
  }, [libraryCubit]);



  const handlePasteFiles = useCallback(
    async (mode = 'copy') => {
      if (copiedFilePaths.length === 0 || !currentFolderPath) {
        return;
      }
      try {
        if (mode === 'copy')
          await invoke(Invokes.CopyFiles, { sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
        else {
          await invoke(Invokes.MoveFiles, { sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
          setCopiedFilePaths([]);
        }
        await refreshImageList();
      } catch (err) {
        setError(`Failed to ${mode} files: ${err}`);
      }
    },
    [copiedFilePaths, currentFolderPath, refreshImageList],
  );

  const requestFullResolution = useCallback(
    debounce((currentAdjustments: any, key: string) => {
      if (!selectedImage?.path) return;

      if (fullResRequestRef.current) {
        fullResRequestRef.current.cancelled = true;
      }

      const request = { cancelled: false };
      fullResRequestRef.current = request;

      invoke(Invokes.GenerateFullscreenPreview, {
        jsAdjustments: currentAdjustments,
      })
        .then((imageData: Uint8Array) => {
          if (!request.cancelled) {
            const blob = new Blob([imageData], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            setFullResolutionUrl(url);
            fullResCacheKeyRef.current = key;
            setIsFullResolution(true);
            setIsLoadingFullRes(false);
          }
        })
        .catch((error: any) => {
          if (!request.cancelled) {
            console.error('Failed to generate full resolution preview:', error);
            setIsFullResolution(false);
            setFullResolutionUrl(null);
            fullResCacheKeyRef.current = null;
            setIsLoadingFullRes(false);
          }
        });
    }, 300),
    [selectedImage?.path],
  );

  useEffect(() => {
    if (isFullResolution && selectedImage?.path) {
      if (fullResCacheKeyRef.current !== visualAdjustmentsKey) {
        setIsLoadingFullRes(true);
        requestFullResolution(adjustments, visualAdjustmentsKey);
      }
    }
  }, [adjustments, isFullResolution, selectedImage?.path, requestFullResolution, visualAdjustmentsKey]);

  const cancelFullResRequest = useCallback(() => {
    if (fullResRequestRef.current) {
      fullResRequestRef.current.cancelled = true;
    }
    if (requestFullResolution.cancel) {
      requestFullResolution.cancel();
    }
  }, [requestFullResolution]);

  const handleFullResolutionLogic = useCallback(
    (targetZoomPercent: number, _currentDisplayWidth: number) => {
      editorCubit.handleFullResolutionLogic(targetZoomPercent, {
        enableZoomHifi: appSettings?.enableZoomHifi !== false,
        fullResolutionUrl,
        fullResCacheKey: fullResCacheKeyRef.current,
        visualAdjustmentsKey,
        requestFullResolution,
        cancelFullResRequest,
      });
    },
    [editorCubit, appSettings?.enableZoomHifi, fullResolutionUrl, visualAdjustmentsKey, requestFullResolution, cancelFullResRequest],
  );

  const handleZoomChange = useCallback(
    (zoomValue: number, fitToWindow: boolean = false) => {
      editorCubit.handleZoomChange(zoomValue, fitToWindow, {
        setZoomCallback: (zoom: number) => {
          isProgrammaticZoom.current = true;
          setZoom(zoom);
        },
        handleFullResolutionLogicCallback: handleFullResolutionLogic,
      });
    },
    [editorCubit, handleFullResolutionLogic],
  );

  const handleUserTransform = useCallback(
    (transformState: TransformState) => {
      if (isProgrammaticZoom.current) {
        isProgrammaticZoom.current = false;
        return;
      }

      editorCubit.handleUserTransform(transformState.scale, {
        handleFullResolutionLogicCallback: handleFullResolutionLogic,
      });
    },
    [editorCubit, handleFullResolutionLogic],
  );

  const isAnyModalOpen = 
    modalsState.createFolder.isOpen ||
    modalsState.renameFolder.isOpen ||
    modalsState.renameFile.isOpen ||
    modalsState.import.isOpen ||
    modalsState.copyPasteSettings.isOpen ||
    modalsState.confirm.isOpen ||
    modalsState.panorama.isOpen ||
    modalsState.culling.isOpen ||
    modalsState.collage.isOpen;

  useKeyboardShortcuts({
    copiedFilePaths,
    customEscapeHandler,
    handleBackToLibrary,
    handleCopyAdjustments,
    handleDeleteAiPatch,
    handleDeleteMaskContainer,
    handleDeleteSelected,
    handleImageSelect,
    handlePasteAdjustments,
    handlePasteFiles,
    handleRate,
    handleRightPanelSelect,
    handleSetColorLabel,
    handleToggleFullScreen,
    handleZoomChange,
    setCopiedFilePaths,
    onSelectPatchContainer: masksCubit.setActiveAiPatchContainer,
  });

  // Open-with-file event listener (app launch with file)
  useEffect(() => {
    let isEffectActive = true;
    const unlistenPromise = listen('open-with-file', (event: any) => {
      if (isEffectActive) {
        setInitialFileToOpen(event.payload as string);
      }
    });
    return () => {
      isEffectActive = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if ([Status.Success, Status.Error, Status.Cancelled].includes(exportState.status)) {
      const timeoutDuration = exportState.status === Status.Success ? 5000 : 3000;

      const timer = setTimeout(() => {
        setExportState({ status: Status.Idle, progress: { current: 0, total: 0 }, errorMessage: '' });
      }, timeoutDuration);
      return () => clearTimeout(timer);
    }
  }, [exportState.status]);

  useEffect(() => {
    if ([Status.Success, Status.Error].includes(importState.status)) {
      const timer = setTimeout(() => {
        setImportState({ status: Status.Idle, progress: { current: 0, total: 0 }, path: '', errorMessage: '' });
      }, IMPORT_TIMEOUT);

      return () => clearTimeout(timer);
    }
  }, [importState.status]);

  useEffect(() => {
    if (libraryActivePath) {
      invoke(Invokes.LoadMetadata, { path: libraryActivePath })
        .then((metadata: any) => {
          if (metadata.adjustments && !metadata.adjustments.is_null) {
            const normalized: Adjustments = normalizeLoadedAdjustments(metadata.adjustments);
            setLibraryActiveAdjustments(normalized);
          } else {
            setLibraryActiveAdjustments(INITIAL_ADJUSTMENTS);
          }
        })
        .catch((err) => {
          console.error('Failed to load metadata for library active image', err);
          setLibraryActiveAdjustments(INITIAL_ADJUSTMENTS);
        });
    } else {
      setLibraryActiveAdjustments(INITIAL_ADJUSTMENTS);
    }
  }, [libraryActivePath]);

  const handleSavePanorama = async (): Promise<string> => {
    const { stitchingSourcePaths } = modalsState.panorama;
    if (stitchingSourcePaths.length === 0) {
      const err = 'Source paths for panorama not found.';
      modalsCubit.setPanoramaError(err);
      throw new Error(err);
    }

    try {
      const savedPath: string = await invoke(Invokes.SavePanorama, {
        firstPathStr: stitchingSourcePaths[0],
      });
      await refreshImageList();
      return savedPath;
    } catch (err) {
      console.error('Failed to save panorama:', err);
      modalsCubit.setPanoramaError(String(err));
      throw err;
    }
  };

  const handleApplyDenoise = useCallback(async (intensity: number) => {
    const { targetPath } = modalsState.denoise;
    if (!targetPath) return;
    
    modalsCubit.updateDenoiseState({ 
      isProcessing: true, 
      error: null, 
      progressMessage: "Starting engine..." 
    });
    
    try {
        await invoke(Invokes.ApplyDenoising, { 
            path: targetPath,
            intensity: intensity 
        });
    } catch (err) {
        modalsCubit.updateDenoiseState({ 
            isProcessing: false, 
            error: String(err) 
        });
    }
  }, [modalsState.denoise.targetPath, modalsCubit]);

  const handleSaveDenoisedImage = async (): Promise<string> => {
    const { targetPath } = modalsState.denoise;
    if (!targetPath) throw new Error("No target path");
    const savedPath = await invoke<string>(Invokes.SaveDenoisedImage, {
        originalPathStr: targetPath
    });
    await refreshImageList();
    return savedPath;
  };

  const handleSaveCollage = async (base64Data: string, firstPath: string): Promise<string> => {
    try {
      const savedPath: string = await invoke(Invokes.SaveCollage, {
        base64Data,
        firstPathStr: firstPath,
      });
      await refreshImageList();
      return savedPath;
    } catch (err) {
      console.error('Failed to save collage:', err);
      setError(`Failed to save collage: ${err}`);
      throw err;
    }
  };

  useEffect(() => {
    if (selectedImage?.isReady) {
      applyAdjustments(adjustments);
      debouncedSave(selectedImage.path, adjustments);
    }
    return () => {
      applyAdjustments.cancel();
      debouncedSave.cancel();
    };
  }, [adjustments, selectedImage?.path, selectedImage?.isReady, applyAdjustments, debouncedSave]);

  useEffect(() => {
    if (activeRightPanel === Panel.Crop && selectedImage?.isReady) {
      debouncedGenerateUncroppedPreview(adjustments);
    }

    return () => debouncedGenerateUncroppedPreview.cancel();
  }, [adjustments, activeRightPanel, selectedImage?.isReady, debouncedGenerateUncroppedPreview]);

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, defaultPath: await homeDir() });
      if (typeof selected === 'string') {
        navigationCubit.setRootPathSimple(selected);
        await handleSelectSubfolder(selected, true);
      }
    } catch (err) {
      console.error('Failed to open directory dialog:', err);
      setError('Failed to open folder selection dialog.');
    }
  };

  const handleContinueSession = () => {
    const restore = async () => {
      if (!appSettings?.lastRootPath) {
        return;
      }

      const root = appSettings.lastRootPath;
      const folderState = appSettings.lastFolderState;
      const pathToSelect = folderState?.currentFolderPath || root;

      navigationCubit.setRootPathSimple(root);

      if (folderState?.expandedFolders) {
        const newExpandedFolders = [...folderState.expandedFolders, root];
        navigationCubit.setExpandedFolders(newExpandedFolders);
      } else {
        navigationCubit.setExpandedFolders([root]);
      }

      navigationCubit.setIsTreeLoading(true);
      try {
        const treeData: FolderNode = await invoke(Invokes.GetFolderTree, { path: root });
        navigationCubit.setFolderTree(treeData);
      } catch (err) {
        console.error('Failed to restore folder tree:', err);
      } finally {
        navigationCubit.setIsTreeLoading(false);
      }

      await handleSelectSubfolder(pathToSelect, false);
    };
    restore().catch((err) => {
      console.error('Failed to restore session, folder might be missing:', err);
      setError('Failed to restore session. The last used folder may have been moved or deleted.');
      if (appSettings) {
        handleSettingsChange({ ...appSettings, lastRootPath: null, lastFolderState: null });
      }
      handleGoHome();
      navigationCubit.setIsTreeLoading(false);
    });
  };

  useEffect(() => {
    if (!initialFileToOpen || !appSettings) {
      return;
    }
    const parentDir = getParentDir(initialFileToOpen);
    if (currentFolderPath !== parentDir) {
      navigationCubit.setRootPathSimple(parentDir);
      handleSelectSubfolder(parentDir, true);
      return;
    }
    const isImageInList = imageList.some(image => image.path === initialFileToOpen);
    if (isImageInList) {
      handleImageSelect(initialFileToOpen);
      setInitialFileToOpen(null);
    } else if (!isViewLoading) {
      console.warn(`'open-with-file' target ${initialFileToOpen} not found in its directory after loading. Aborting.`);
      setInitialFileToOpen(null);
    }
  }, [initialFileToOpen, appSettings, currentFolderPath, imageList, isViewLoading, handleSelectSubfolder, handleImageSelect, navigationCubit]);

  const handleGoHome = () => {
    navigationCubit.clearRootPath();
    libraryCubit.clear();
    setLibraryActivePath(null);
    setIsLibraryExportPanelVisible(false);
  };

  const handleMultiSelectClick = (path: string, event: any, options: MultiSelectOptions) => {
    const { ctrlKey, metaKey, shiftKey } = event;
    const isCtrlPressed = ctrlKey || metaKey;
    const { shiftAnchor, onSimpleClick, updateLibraryActivePath } = options;

    if (shiftKey && shiftAnchor) {
      const lastIndex = sortedImageList.findIndex((f) => f.path === shiftAnchor);
      const currentIndex = sortedImageList.findIndex((f) => f.path === path);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const range = sortedImageList.slice(start, end + 1).map((f: ImageFile) => f.path);
        const baseSelection = isCtrlPressed ? multiSelectedPaths : [shiftAnchor];
        const newSelection = Array.from(new Set([...baseSelection, ...range]));

        libraryCubit.setSelection(newSelection);
        if (updateLibraryActivePath) {
          setLibraryActivePath(path);
        }
      }
    } else if (isCtrlPressed) {
      if (multiSelectedPaths.includes(path)) {
        libraryCubit.removeFromSelection(path);
      } else {
        libraryCubit.addToSelection(path);
      }

      const newSelectionArray = libraryCubit.state.multiSelectedPaths;

      if (updateLibraryActivePath) {
        if (newSelectionArray.includes(path)) {
          setLibraryActivePath(path);
        } else if (newSelectionArray.length > 0) {
          setLibraryActivePath(newSelectionArray[newSelectionArray.length - 1]);
        } else {
          setLibraryActivePath(null);
        }
      }
    } else {
      onSimpleClick(path);
    }
  };

  const handleLibraryImageSingleClick = (path: string, event: any) => {
    handleMultiSelectClick(path, event, {
      shiftAnchor: libraryActivePath,
      updateLibraryActivePath: true,
      onSimpleClick: (p: string) => {
        libraryCubit.setSelection([p]);
        setLibraryActivePath(p);
      },
    });
  };

  const handleImageClick = (path: string, event: any) => {
    const inEditor = !!selectedImage;
    handleMultiSelectClick(path, event, {
      shiftAnchor: inEditor ? selectedImage.path : libraryActivePath,
      updateLibraryActivePath: !inEditor,
      onSimpleClick: handleImageSelect,
    });
  };

  useEffect(() => {
    const invokeWaveForm = async () => {
      const waveForm: any = await invoke(Invokes.GenerateWaveform).catch((err) =>
        console.error('Failed to generate waveform:', err),
      );
      if (waveForm) {
        setWaveform(waveForm);
      }
    };

    if (isWaveformVisible && selectedImage?.isReady && !waveform) {
      invokeWaveForm();
    }
  }, [isWaveformVisible, selectedImage?.isReady, waveform]);

  useEffect(() => {
    if (selectedImage && !selectedImage.isReady && selectedImage.path) {
    let isEffectActive = true;
    const loadFullImageData = async () => {
        try {
        const loadImageResult: any = await invoke(Invokes.LoadImage, { path: selectedImage.path });
        if (!isEffectActive) {
            return;
        }
        if (!isEffectActive) {
            return;
        }

        const { width, height } = loadImageResult;
        setOriginalSize({ width, height });

        if (appSettings?.editorPreviewResolution) {
            const maxSize = appSettings.editorPreviewResolution;
            const aspectRatio = width / height;

            if (width > height) {
            const pWidth = Math.min(width, maxSize);
            const pHeight = Math.round(pWidth / aspectRatio);
            setPreviewSize({ width: pWidth, height: pHeight });
            } else {
            const pHeight = Math.min(height, maxSize);
            const pWidth = Math.round(pHeight * aspectRatio);
            setPreviewSize({ width: pWidth, height: pHeight });
            }
        } else {
            setPreviewSize({ width: 0, height: 0 });
        }

        setIsFullResolution(false);
        setFullResolutionUrl(null);
        fullResCacheKeyRef.current = null;

        const blob = new Blob([loadImageResult.original_image_bytes], { type: 'image/jpeg' });
        const originalUrl = URL.createObjectURL(blob);

        // Update selected image with loaded data
        if (editorState.selectedImage && editorState.selectedImage.path === selectedImage.path) {
          updateSelectedImage({
            exif: loadImageResult.exif,
            height: loadImageResult.height,
            isRaw: loadImageResult.is_raw,
            isReady: true,
            metadata: loadImageResult.metadata,
            originalUrl: originalUrl,
            width: loadImageResult.width,
          });
        }

        let initialAdjusts;
        if (loadImageResult.metadata.adjustments && !loadImageResult.metadata.adjustments.is_null) {
            initialAdjusts = normalizeLoadedAdjustments(loadImageResult.metadata.adjustments);
        } else {
            initialAdjusts = {
            ...INITIAL_ADJUSTMENTS,
            aspectRatio: loadImageResult.width / loadImageResult.height,
            };
        }
        if (loadImageResult.metadata.adjustments && !loadImageResult.metadata.adjustments.is_null) {
            initialAdjusts = normalizeLoadedAdjustments(loadImageResult.metadata.adjustments);
        }
        resetAdjustmentsHistory(initialAdjusts);
        } catch (err) {
        if (isEffectActive) {
            console.error('Failed to load image:', err);
            setError(`Failed to load image: ${err}`);
            setSelectedImage(null);
        }
        } finally {
        if (isEffectActive) {
            setIsViewLoading(false);
        }
        }
    };
    loadFullImageData();
    return () => {
        isEffectActive = false;
    };
    }
  }, [selectedImage?.path, selectedImage?.isReady, resetAdjustmentsHistory, appSettings?.editorPreviewResolution]);

  const handleClearSelection = () => {
    if (selectedImage) {
      libraryCubit.setSelection([selectedImage.path]);
    } else {
      libraryCubit.clearSelection();
      setLibraryActivePath(null);
    }
  };

  const handleRenameFiles = useCallback(async (paths: Array<string>) => {
    if (paths && paths.length > 0) {
      modalsCubit.openRenameFile(paths);
    }
  }, [modalsCubit]);

  const handleSaveRename = useCallback(
    async (nameTemplate: string) => {
      const renameTargetPaths = modalsState.renameFile.paths || [];
      if (renameTargetPaths.length > 0 && nameTemplate) {
        try {
          const newPaths: Array<string> = await invoke(Invokes.RenameFiles, {
            nameTemplate,
            paths: renameTargetPaths,
          });

          await refreshImageList();

          if (selectedImage && renameTargetPaths.includes(selectedImage.path)) {
            const oldPathIndex = renameTargetPaths.indexOf(selectedImage.path);

            if (newPaths[oldPathIndex]) {
              handleImageSelect(newPaths[oldPathIndex]);
            } else {
              handleBackToLibrary();
            }
          }

          if (libraryActivePath && renameTargetPaths.includes(libraryActivePath)) {
            const oldPathIndex = renameTargetPaths.indexOf(libraryActivePath);

            if (newPaths[oldPathIndex]) {
              setLibraryActivePath(newPaths[oldPathIndex]);
            } else {
              setLibraryActivePath(null);
            }
          }

          libraryCubit.setSelection(newPaths);
        } catch (err) {
          setError(`Failed to rename files: ${err}`);
        }
      }
    },
    [modalsState.renameFile.paths, refreshImageList, selectedImage, libraryActivePath, handleImageSelect, handleBackToLibrary, libraryCubit],
  );

  const handleStartImport = async (settings: AppSettings) => {
    const { targetFolder, sourcePaths } = modalsState.import;
    if (sourcePaths && sourcePaths.length > 0 && targetFolder) {
      invoke(Invokes.ImportFiles, {
        destinationFolder: targetFolder,
        settings: settings,
        sourcePaths: sourcePaths,
      }).catch((err) => {
        console.error('Failed to start import:', err);
        setImportState({ status: Status.Error, errorMessage: `Failed to start import: ${err}` });
      });
    }
  };

  const handleResetAdjustments = useCallback(
    (paths?: Array<string>) => {
      editorCubit.resetAdjustmentsForPaths(paths || [], libraryCubit);
    },
    [editorCubit, libraryCubit],
  );

  const handleImportClick = useCallback(
    async (targetPath: string) => {
      try {
        const nonRaw = supportedTypes?.nonRaw || [];
        const raw = supportedTypes?.raw || [];
        const allImageExtensions = [...nonRaw, ...raw];

        const selected = await open({
          filters: [
            {
              name: 'All Supported Images',
              extensions: allImageExtensions,
            },
            {
              name: 'RAW Images',
              extensions: raw,
            },
            {
              name: 'Standard Images (JPEG, PNG, etc.)',
              extensions: nonRaw,
            },
            {
              name: 'All Files',
              extensions: ['*'],
            },
          ],
          multiple: true,
          title: 'Select files to import',
        });

        if (Array.isArray(selected) && selected.length > 0) {
          modalsCubit.openImport(targetPath, selected);
        }
      } catch (err) {
        console.error('Failed to open file dialog for import:', err);
      }
    },
    [supportedTypes],
  );

  const {
    handleEditorContextMenu,
    handleThumbnailContextMenu,
    handleFolderTreeContextMenu,
    handleMainLibraryContextMenu,
  } = useContextMenus({
    handlers: {
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
    },
    appSettings,
    copiedAdjustments,
    canUndo,
    canRedo,
  });

  const handleCreateFolder = async (folderName: string) => {
    const parentPath = modalsState.createFolder.parentPath;
    if (folderName && folderName.trim() !== '' && parentPath) {
      try {
        await invoke(Invokes.CreateFolder, { path: `${parentPath}/${folderName.trim()}` });
        refreshAllFolderTrees();
      } catch (err) {
        setError(`Failed to create folder: ${err}`);
      }
    }
  };

  const handleRenameFolder = async (newName: string) => {
    const folderPath = modalsState.renameFolder.path;
    if (newName && newName.trim() !== '' && folderPath) {
      try {
        const oldPath = folderPath;
        const trimmedNewName = newName.trim();

        await invoke(Invokes.RenameFolder, { path: oldPath, newName: trimmedNewName });

        const parentDir = getParentDir(oldPath);
        const separator = oldPath.includes('/') ? '/' : '\\';
        const newPath = parentDir ? `${parentDir}${separator}${trimmedNewName}` : trimmedNewName;

        const newAppSettings = { ...appSettings } as AppSettings;
        let settingsChanged = false;

        if (rootPath === oldPath) {
          navigationCubit.setRootPathSimple(newPath);
          newAppSettings.lastRootPath = newPath;
          settingsChanged = true;
        }
        if (currentFolderPath?.startsWith(oldPath)) {
          const newCurrentPath = currentFolderPath.replace(oldPath, newPath);
          navigationCubit.setCurrentFolderPath(newCurrentPath);
        }

        const currentPins = appSettings?.pinnedFolders || [];
        if (currentPins.includes(oldPath)) {
          const newPins = currentPins.map((p: string) => (p === oldPath ? newPath : p)).sort((a: string, b: string) => a.localeCompare(b));
          newAppSettings.pinnedFolders = newPins;
          navigationCubit.setPinnedFolders(newPins);
          settingsChanged = true;
        }

        if (settingsChanged) {
          handleSettingsChange(newAppSettings);
        }

        await refreshAllFolderTrees();

      } catch (err) {
        setError(`Failed to rename folder: ${err}`);
      }
    }
  };

  const renderMainView = () => {
    if (selectedImage) {
      return (
        <div className="flex flex-row flex-grow h-full min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <Editor
              onContextMenu={handleEditorContextMenu}
              onGenerateAiMask={handleGenerateAiMask}
              onQuickErase={handleQuickErase}
              onZoomed={handleUserTransform}
              transformWrapperRef={transformWrapperRef}
              onZoomChange={handleZoomChange}
            />
            <Resizer
              direction={Orientation.Horizontal}
              onMouseDown={createResizeHandler('bottom', bottomPanelHeight)}
            />
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

          <Resizer
            onMouseDown={createResizeHandler('right', rightPanelWidth)}
            direction={Orientation.Vertical}
          />
          <RightPanelContainer
            onGenerateAiForegroundMask={handleGenerateAiForegroundMask}
            onGenerateAiSkyMask={handleGenerateAiSkyMask}
            onDeletePatch={handleDeleteAiPatch}
            onGenerativeReplace={handleGenerativeReplace}
            onTogglePatchVisibility={handleToggleAiPatchVisibility}
            setCustomEscapeHandler={setCustomEscapeHandler}
          />
        </div>
      );
    }
    return (
      <div className="flex flex-row flex-grow h-full min-h-0">
        <div className="flex-1 flex flex-col min-w-0 gap-2">
          {activeView === 'community' ? (
            <CommunityPage
              onBackToLibrary={() => navigationCubit.switchToLibrary()}
              supportedTypes={supportedTypes}
              imageList={sortedImageList}
              currentFolderPath={currentFolderPath}
            />
          ) : (
            <MainLibrary
              activePath={libraryActivePath}
              aiModelDownloadStatus={aiModelDownloadStatus}
              importState={importState}
              indexingProgress={indexingProgress}
              isIndexing={isIndexing}
              isThumbnailsLoading={isThumbnailsLoading}
              isLoading={isViewLoading}
              libraryScrollTop={libraryScrollTop}
              onContextMenu={handleThumbnailContextMenu}
              onContinueSession={handleContinueSession}
              onEmptyAreaContextMenu={handleMainLibraryContextMenu}
              onGoHome={handleGoHome}
              onImageClick={handleLibraryImageSingleClick}
              onImageDoubleClick={handleImageSelect}
              onLibraryRefresh={handleLibraryRefresh}
              onOpenFolder={handleOpenFolder}
              setLibraryScrollTop={setLibraryScrollTop}
              onNavigateToCommunity={() => navigationCubit.switchToCommunity()}
            />
          )}
          {rootPath && (
            <BottomBar
              onCopy={handleCopyAdjustments}
              onPaste={() => handlePasteAdjustments()}
              onRate={handleRate}
              onReset={() => handleResetAdjustments()}
            />
          )}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    return renderMainView();
  };

  return (
    <div
      className={clsx(
        'flex flex-col h-screen bg-bg-primary font-sans text-text-primary overflow-hidden select-none',
        (appSettings?.adaptiveEditorTheme || isAnimatingTheme) && 'enable-color-transitions',
      )}
    >
      {appSettings?.decorations || (!isWindowFullScreen && <TitleBar />)}
      <div
        className={clsx('flex-1 flex flex-col min-h-0', [
          rootPath && 'p-2 gap-2',
          !appSettings?.decorations && rootPath && !isWindowFullScreen && 'pt-12',
        ])}
      >
        {error && (
          <div className="absolute top-12 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg z-50">
            {error}
            <button onClick={() => setError(null)} className="ml-4 font-bold hover:text-gray-200">
              ×
            </button>
          </div>
        )}
        <div className="flex flex-row flex-grow h-full min-h-0">
          <LeftPanelContainer onContextMenu={handleFolderTreeContextMenu} />
          <div className="flex-1 flex flex-col min-w-0">{renderContent()}</div>
          {!selectedImage && isLibraryExportPanelVisible && (
            <Resizer
              direction={Orientation.Vertical}
              onMouseDown={createResizeHandler('right', rightPanelWidth)}
            />
          )}
          <div
            className={clsx('flex-shrink-0 overflow-hidden', !isResizing && 'transition-all duration-300 ease-in-out')}
            style={{ width: isLibraryExportPanelVisible ? `${rightPanelWidth}px` : '0px' }}
          >
            <LibraryExportPanel
              isVisible={isLibraryExportPanelVisible}
              onClose={() => setIsLibraryExportPanelVisible(false)}
            />
          </div>
        </div>
      </div>
      <CopyPasteSettingsModal
        settings={appSettings?.copyPasteSettings as CopyPasteSettings}
        onSave={(newSettings) => handleSettingsChange({ ...appSettings, copyPasteSettings: newSettings } as AppSettings)}
      />
      <PanoramaModal
        onOpenFile={(path: string) => {
          handleImageSelect(path);
        }}
        onSave={handleSavePanorama}
      />
      <DenoiseModal 
        onDenoise={handleApplyDenoise}
        onSave={handleSaveDenoisedImage}
        onOpenFile={handleImageSelect}
      />
      <CreateFolderModal onSave={handleCreateFolder} />
      <RenameFolderModal onSave={handleRenameFolder} />
      <RenameFileModal onSave={handleSaveRename} />
      <ConfirmModal />
      <ImportSettingsModal onSave={handleStartImport} />
      <CullingModal
        thumbnails={thumbnails}
        onApply={(action, paths) => {
          if (action === 'reject') {
            handleSetColorLabel('red', paths);
          } else if (action === 'rate_zero') {
            handleRate(1, paths);
          } else if (action === 'delete') {
            executeDelete(paths, { includeAssociated: false });
          }
          modalsCubit.closeCulling();
        }}
      />
      <CollageModal
        onSave={handleSaveCollage}
        thumbnails={thumbnails}
      />
    </div>
  );
}

const AppWrapper = () => (
  <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
    <ContextMenuProvider>
      <App />
    </ContextMenuProvider>
  </ClerkProvider>
);

export default AppWrapper;