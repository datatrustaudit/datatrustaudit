import AppHeader from '@/components/AppHeader';
import AuditContainer from '@/components/AuditContainer';

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 transition-colors duration-300">
      <AppHeader />
      <main className="container mx-auto px-4 py-8">
        <AuditContainer />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-950/50 backdrop-blur-sm mt-8">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              © 2024 GTM Audit Pro. Auditoria de Tags & Conformidade LGPD.
            </p>
            <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              <a href="/docs" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                API Docs
              </a>
              <span>•</span>
              <a href="#" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                Suporte
              </a>
              <span>•</span>
              <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                v2.0
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
