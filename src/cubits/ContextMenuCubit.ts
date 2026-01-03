import { Cubit } from '@blac/core';
import { ForwardRefExoticComponent, ReactNode } from 'react';
export const OPTION_SEPARATOR = 'separator';

type ContextMenuItemSeparator = {
  type: typeof OPTION_SEPARATOR;
};

type ContextMenuItem = {
  label: string;
  icon?: ReactNode | ForwardRefExoticComponent<any>;
  color?: string;
  disabled?: boolean;
};

type ContextMenuItemAction = ContextMenuItem & {
  action: () => void;
};

type ContextMenuItemCustom = () => ReactNode;

type ContextMenuItemSubmenu = ContextMenuItem & {
  submenu: (ContextMenuItemAction | ContextMenuItemCustom)[];
};

export type ContextMenuOption = ContextMenuItemSeparator | ContextMenuItemAction | ContextMenuItemSubmenu;

export type ContextMenuProps = {
  show: boolean;
  options?: ContextMenuOption[];
  position?: {
    x: number;
    y: number;
  };
  size?: {
    width: number;
    height: number;
  };
};

export default class ConteMenusCubit extends Cubit<ContextMenuProps> {
  constructor() {
    super({
      show: false,
    });
  }

  showForEvent = (event: MouseEvent, options: ContextMenuOption[]) => {
    this.patch({
      options,
    });
  };

  reset = () => {
    this.emit({
      show: false,
    });
  };

  hideContextMenu = () => {
    this.reset();
  };
}
