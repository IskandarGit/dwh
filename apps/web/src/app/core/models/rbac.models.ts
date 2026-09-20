export interface Role {
  id: number;
  name: string;
  pcode?: string;
  state: 'A' | 'P';
  orderNo: number;
  createdAt: string;
  modifiedAt: string;
  usersCount?: number;
}

export interface FormTreeItem {
  formCode: string;
  module: string;
  formName: string;
  action: string;
  actionName: string;
}

export interface PermissionPair {
  formCode: string;
  action: string;
}
