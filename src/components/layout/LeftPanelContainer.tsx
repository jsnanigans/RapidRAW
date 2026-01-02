import { useBloc } from '@blac/react';
import { NavigationCubit, UICubit, SettingsCubit } from '../../cubits';
import FolderTree from '../panel/FolderTree';
import Resizer from '../ui/Resizer';
import { Orientation } from '../ui/AppProperties';

interface LeftPanelContainerProps {
  onContextMenu: (event: React.MouseEvent, path: string | null, isPinned?: boolean) => void;
}

export default function LeftPanelContainer({ onContextMenu }: LeftPanelContainerProps) {
  const [navigationState] = useBloc(NavigationCubit);
  const [uiState, uiCubit] = useBloc(UICubit);
  const [settingsState] = useBloc(SettingsCubit);

  const { rootPath } = navigationState;
  const { leftPanelWidth } = uiState;
  const uiVisibility = settingsState.appSettings?.uiVisibility ?? { folderTree: true, filmstrip: true };

  const createResizeHandler = uiCubit.createResizeHandler;

  if (!rootPath) {
    return null;
  }

  return (
    <>
      <FolderTree
        onContextMenu={onContextMenu}
        style={{ width: uiVisibility.folderTree ? `${leftPanelWidth}px` : '32px' }}
      />
      <Resizer
        direction={Orientation.Vertical}
        onMouseDown={createResizeHandler('left', leftPanelWidth)}
      />
    </>
  );
}
