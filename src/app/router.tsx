import { createBrowserRouter } from 'react-router';
import { AppFrame } from '@/components/app-frame';
import { AddPanelPage } from '@/pages/add-panel-page';
import { HomePage } from '@/pages/home-page';
import { PanelPage } from '@/pages/panel-page';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppFrame,
    children: [
      { index: true, Component: HomePage },
      { path: 'add', Component: AddPanelPage },
      { path: 'panel/:instanceId', Component: PanelPage },
    ],
  },
]);
