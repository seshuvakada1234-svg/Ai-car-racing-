/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { AssetInstallScreen } from "./AssetInstallScreen";

interface AssetDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AssetDownloadModal: React.FC<AssetDownloadModalProps> = ({ isOpen, onClose }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          id="asset-dl-modal-overlay"
        >
          <div className="relative w-full max-w-2xl h-[560px] overflow-hidden rounded-3xl border border-slate-800/80 shadow-2xl bg-slate-950">
            <AssetInstallScreen onComplete={onClose} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
