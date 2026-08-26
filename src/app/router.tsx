import { createBrowserRouter, Navigate } from 'react-router';
import { AppFrame } from '@/components/app-frame';
import { PanelRoute } from '@/components/panel-route';
import { AddPanelPage } from '@/pages/add-panel-page';
import { HomePage } from '@/pages/home-page';
import { AccountPage } from '@/pages/panel/account-page';
import { AdminUserDetailPage } from '@/pages/panel/admin/user-detail-page';
import { AdminUsersPage } from '@/pages/panel/admin/users-page';
import { OverviewPage } from '@/pages/panel/overview-page';
import { SecurityPage } from '@/pages/panel/security-page';
import { ServerCreatePage } from '@/pages/panel/servers/server-create-page';
import { ServerDetailPage } from '@/pages/panel/servers/server-detail-page';
import { ServerListPage } from '@/pages/panel/servers/server-list-page';
import { SetupPage } from '@/pages/panel/setup-page';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppFrame,
    children: [
      { index: true, Component: HomePage },
      { path: 'add', Component: AddPanelPage },
    ],
  },
  {
    path: '/panel/:instanceId',
    Component: PanelRoute,
    children: [
      { index: true, Component: OverviewPage },
      { path: 'servers', Component: ServerListPage },
      { path: 'servers/new', Component: ServerCreatePage },
      { path: 'servers/:serverId', Component: ServerDetailPage },
      { path: 'account', Component: AccountPage },
      { path: 'security', Component: SecurityPage },
      { path: 'setup', Component: SetupPage },
      { path: 'administration', Component: (): React.JSX.Element => <Navigate to="../admin/users" relative="route" replace /> },
      { path: 'admin/users', Component: AdminUsersPage },
      { path: 'admin/users/:userId', Component: AdminUserDetailPage },
      { path: '*', Component: (): React.JSX.Element => <Navigate to=".." relative="route" replace /> },
    ],
  },
]);