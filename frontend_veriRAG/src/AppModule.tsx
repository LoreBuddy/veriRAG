import { RouterProvider } from 'react-router';
import { router } from '@/app/router';
import { useAuthBootstrap } from '@/too/auth/useAuthBootstrap';

export default function App() {
    useAuthBootstrap();
    return <RouterProvider router={router} />;
}