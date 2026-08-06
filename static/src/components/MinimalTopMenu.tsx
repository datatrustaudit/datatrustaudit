import { Link } from 'react-router-dom';
import { Tag } from 'lucide-react';
import LocaleSelector from '@/components/LocaleSelector';

const MinimalTopMenu = () => (
  <nav className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
      <Link to="/" className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
          <Tag className="h-4 w-4" />
        </div>
        <span className="font-bold text-white">DataTrust Audit</span>
      </Link>
      <LocaleSelector compact />
    </div>
  </nav>
);

export default MinimalTopMenu;
