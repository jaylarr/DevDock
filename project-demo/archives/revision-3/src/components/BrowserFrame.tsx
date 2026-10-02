import React from 'react';

export const BrowserFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{
  position: 'absolute', top: 94, left: 112, width: 1696, overflow: 'hidden', borderRadius: 9,
  border: '1px solid #b8dec845', background: '#1e2830', boxShadow: '0 20px 65px #00000065, 0 0 35px #b8dec808',
}}>
  <div style={{ height: 22, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 6, borderBottom: '1px solid #3b3b40' }}>
    {[0, 1, 2].map((item) => <div key={item} style={{ width: 5, height: 5, borderRadius: '50%', background: '#707178' }} />)}
    <span style={{ fontSize: 11, letterSpacing: 1.2, color: '#aaaab2', marginLeft: 10 }}>LOCAL WORKSPACE</span>
  </div>
  <div style={{ width: 1696, height: 869.2, overflow: 'hidden' }}>{children}</div>
</div>;
