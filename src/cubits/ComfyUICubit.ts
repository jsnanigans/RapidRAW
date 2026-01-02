import { Cubit, blac, borrow } from '@blac/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Invokes } from '../components/ui/AppProperties';
import { Adjustments, AiPatch, Coord } from '../utils/adjustments';
import { SubMask } from '../components/panel/right/Masks';
import { EditorCubit } from './EditorCubit';
import { MasksCubit } from './MasksCubit';

export interface ComfyUIState {
  isConnected: boolean;
  isGenerating: boolean;
  modelDownloadStatus: string | null;
}

const INITIAL_STATE: ComfyUIState = {
  isConnected: false,
  isGenerating: false,
  modelDownloadStatus: null,
};

@blac({ keepAlive: true })
export class ComfyUICubit extends Cubit<ComfyUIState> {
  private unlistenFns: UnlistenFn[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super(INITIAL_STATE);
    this.init();

    this.onSystemEvent('dispose', () => {
      this.cleanup();
    });
  }

  private init = async () => {
    const unlistenStatus = await listen('comfyui-status-update', (event: any) => {
      this.patch({ isConnected: event.payload.connected });
    });

    const unlistenDownloadStart = await listen('ai-model-download-start', (event: any) => {
      this.patch({ modelDownloadStatus: event.payload });
    });

    const unlistenDownloadFinish = await listen('ai-model-download-finish', () => {
      this.patch({ modelDownloadStatus: null });
    });

    this.unlistenFns = [unlistenStatus, unlistenDownloadStart, unlistenDownloadFinish];

    invoke(Invokes.CheckComfyuiStatus).catch(console.error);

    this.pollInterval = setInterval(() => {
      invoke(Invokes.CheckComfyuiStatus).catch(console.error);
    }, 3000);
  };

  private cleanup = () => {
    this.unlistenFns.forEach((fn) => fn());
    this.unlistenFns = [];
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  };

  setIsConnected = (connected: boolean) => {
    this.patch({ isConnected: connected });
  };

  setIsGenerating = (generating: boolean) => {
    this.patch({ isGenerating: generating });
  };

  setModelDownloadStatus = (status: string | null) => {
    this.patch({ modelDownloadStatus: status });
  };

  startGenerating = () => {
    this.patch({ isGenerating: true });
  };

  stopGenerating = () => {
    this.patch({ isGenerating: false });
  };

  generativeReplace = async (
    patchId: string,
    prompt: string,
    useFastInpaint: boolean,
  ) => {
    const editorCubit = borrow(EditorCubit);
    const masksCubit = borrow(MasksCubit);
    const { selectedImage, adjustments } = editorCubit.state;
    if (!selectedImage?.path || this.state.isGenerating) {
      return;
    }

    const patch: AiPatch | undefined = adjustments.aiPatches.find((p: AiPatch) => p.id === patchId);
    if (!patch) {
      console.error('Could not find AI patch to generate for:', patchId);
      return;
    }

    const patchDefinition = { ...patch, prompt };

    editorCubit.setAdjustments((prev: Adjustments) => ({
      ...prev,
      aiPatches: prev.aiPatches.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: true, prompt } : p)),
    }));

    this.startGenerating();

    try {
      const newPatchDataJson: any = await invoke(Invokes.InvokeGenerativeReplaseWithMaskDef, {
        currentAdjustments: adjustments,
        patchDefinition: patchDefinition,
        path: selectedImage.path,
        useFastInpaint: useFastInpaint,
      });

      const newPatchData = JSON.parse(newPatchDataJson);
      editorCubit.setAdjustments((prev: Adjustments) => ({
        ...prev,
        aiPatches: prev.aiPatches.map((p: AiPatch) =>
          p.id === patchId
            ? {
                ...p,
                patchData: newPatchData,
                isLoading: false,
                name: useFastInpaint ? 'Inpaint' : prompt && prompt.trim() ? prompt.trim() : p.name,
              }
            : p,
        ),
      }));
      masksCubit.clearActiveAiPatch();
    } catch (err) {
      console.error('Generative replace failed:', err);
      editorCubit.setError(`AI Replace Failed: ${err}`);
      editorCubit.setAdjustments((prev: Adjustments) => ({
        ...prev,
        aiPatches: prev.aiPatches.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: false } : p)),
      }));
    } finally {
      this.stopGenerating();
    }
  };

  quickErase = async (
    subMaskId: string | null,
    startPoint: Coord,
    endPoint: Coord,
  ) => {
    const editorCubit = borrow(EditorCubit);
    const masksCubit = borrow(MasksCubit);
    const { selectedImage, adjustments } = editorCubit.state;
    if (!selectedImage?.path || this.state.isGenerating) {
      return;
    }

    const patchId = adjustments.aiPatches.find((p: AiPatch) =>
      p.subMasks.some((sm: SubMask) => sm.id === subMaskId),
    )?.id;
    if (!patchId) {
      console.error('Could not find AI patch container for Quick Erase.');
      return;
    }

    this.startGenerating();
    editorCubit.setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      aiPatches: prev.aiPatches?.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: true } : p)),
    }));

    try {
      const newMaskParams: any = await invoke(Invokes.GenerateAiSubjectMask, {
        endPoint: [endPoint.x, endPoint.y],
        flipHorizontal: adjustments.flipHorizontal,
        flipVertical: adjustments.flipVertical,
        orientationSteps: adjustments.orientationSteps,
        path: selectedImage.path,
        rotation: adjustments.rotation,
        startPoint: [startPoint.x, startPoint.y],
      });

      const subMaskToUpdate = adjustments.aiPatches
        ?.find((p: AiPatch) => p.id === patchId)
        ?.subMasks.find((sm: SubMask) => sm.id === subMaskId);
      const finalSubMaskParams: any = { ...subMaskToUpdate?.parameters, ...newMaskParams };
      const updatedAdjustmentsForBackend = {
        ...adjustments,
        aiPatches: adjustments.aiPatches.map((p: AiPatch) =>
          p.id === patchId
            ? {
                ...p,
                subMasks: p.subMasks.map((sm: SubMask) =>
                  sm.id === subMaskId ? { ...sm, parameters: finalSubMaskParams } : sm,
                ),
              }
            : p,
        ),
      };

      const patchDefinitionForBackend = updatedAdjustmentsForBackend.aiPatches.find((p: AiPatch) => p.id === patchId);
      const newPatchDataJson: any = await invoke(Invokes.InvokeGenerativeReplaseWithMaskDef, {
        currentAdjustments: updatedAdjustmentsForBackend,
        patchDefinition: { ...patchDefinitionForBackend, prompt: '' },
        path: selectedImage.path,
        useFastInpaint: true,
      });

      const newPatchData = JSON.parse(newPatchDataJson);
      if (!newPatchData?.color || !newPatchData?.mask) {
        throw new Error('Inpainting failed to return a valid result.');
      }

      editorCubit.setAdjustments((prev: Partial<Adjustments>) => ({
        ...prev,
        aiPatches: prev.aiPatches?.map((p: AiPatch) =>
          p.id === patchId
            ? {
                ...p,
                patchData: newPatchData,
                isLoading: false,
                subMasks: p.subMasks.map((sm: SubMask) =>
                  sm.id === subMaskId ? { ...sm, parameters: finalSubMaskParams } : sm,
                ),
              }
            : p,
        ),
      }));
      masksCubit.clearActiveAiPatch();
    } catch (err: any) {
      console.error('Quick Erase failed:', err);
      editorCubit.setError(`Quick Erase Failed: ${err.message || String(err)}`);
      editorCubit.setAdjustments((prev: Partial<Adjustments>) => ({
        ...prev,
        aiPatches: prev.aiPatches?.map((p: AiPatch) => (p.id === patchId ? { ...p, isLoading: false } : p)),
      }));
    } finally {
      this.stopGenerating();
    }
  };
}
