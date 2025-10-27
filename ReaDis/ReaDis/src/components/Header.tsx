import React from 'react';
import { Zap } from 'lucide-react';
import { LogoImage } from './LogoImage';

export const Header: React.FC = () => {
  return (
    <header className="bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 text-white">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-start space-y-2">
            <div className="bg-white bg-opacity-25 rounded-lg p-3 shadow-lg ring-1 ring-white/40">
              <LogoImage height={64} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">ReaDis</h1>
              <p className="text-brand-100">Extract and read content from any source</p>
            </div>
          </div>
          
          <div className="hidden md:flex items-center space-x-6">
            <div className="text-center">
              <div className="flex items-center space-x-1 text-lg font-semibold">
                <Zap className="h-5 w-5" />
                
              </div>
              
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

