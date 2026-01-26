
import AuditHeader from '@/components/AuditHeader';
import AuditContainer from '@/components/AuditContainer';

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="container mx-auto px-4 py-8">
        <AuditHeader />
        <AuditContainer />
      </div>
    </div>
  );
};

export default Index;
