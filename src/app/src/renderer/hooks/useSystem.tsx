import React, {createContext, useCallback, useContext, useMemo, useState} from "react";
import {fetchSystemInfoData, SystemInfo, Recipes, fetchSystemChecks, SystemCheck} from "../utils/systemData";

interface SystemContextValue {
  systemInfo?: SystemInfo;
  isLoading: boolean;
  supportedRecipes: SupportedRecipes;
  systemChecks: SystemCheck[];
  shouldShowSystemChecks: boolean;
  checkForRocmUsage: () => Promise<void>;
  dismissSystemChecks: (permanent: boolean) => void;
  refresh: () => Promise<void>;
  ensureSystemInfoLoaded: () => Promise<void>;
}

// Programmatic structure: recipe -> list of supported backends
export interface SupportedRecipes {
  [recipeName: string]: string[]; // e.g., { llamacpp: ['vulkan', 'rocm', 'cpu'], 'ryzenai-llm': ['default'] }
}

const SystemContext = createContext<SystemContextValue | null>(null);

const SYSTEM_CHECKS_DISMISSED_KEY = 'lemonade_system_checks_dismissed';

export const SystemProvider: React.FC<{ children: React.ReactNode }> = ({children}) => {
  const [systemInfo, setSystemInfo] = useState<SystemInfo>();
  const [systemChecks, setSystemChecks] = useState<SystemCheck[]>([]);
  const [shouldShowSystemChecks, setShouldShowSystemChecks] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // Changed to false - no longer loading on startup
  const [hasLoaded, setHasLoaded] = useState(false); // Track if we've ever loaded system info

  // Programmatically extract supported recipes and backends
  const supportedRecipes = useMemo<SupportedRecipes>(() => {
    const result: SupportedRecipes = {};

    const recipes = systemInfo?.recipes;
    if (!recipes) return result;

    // Iterate over all recipes dynamically
    for (const [recipeName, recipe] of Object.entries(recipes)) {
      if (!recipe?.backends) continue;

      // Collect all supported backends for this recipe (not just available/installed)
      const supportedBackends: string[] = [];
      for (const [backendName, backend] of Object.entries(recipe.backends)) {
        if (backend?.supported) {
          supportedBackends.push(backendName);
        }
      }

      // Only include recipes that have at least one supported backend
      if (supportedBackends.length > 0) {
        result[recipeName] = supportedBackends;
      }
    }

    return result;
  }, [systemInfo]);

  // Fetch system info from the server
  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchSystemInfoData();
      setSystemInfo(data.info);

      // Fetch system checks (kernel issues, driver warnings, etc.)
      const checks = await fetchSystemChecks();
      setSystemChecks(checks);

      setHasLoaded(true);

    } catch (error) {
      console.error('Failed to fetch system info:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Ensure system info is loaded (for lazy loading on first model use)
  const ensureSystemInfoLoaded = useCallback(async () => {
    if (!hasLoaded && !isLoading) {
      await refresh();
    }
  }, [hasLoaded, isLoading, refresh]);

  // Check if user has dismissed system checks permanently
  const isSystemChecksDismissed = useCallback(() => {
    try {
      const dismissed = localStorage.getItem(SYSTEM_CHECKS_DISMISSED_KEY);
      return dismissed === 'true';
    } catch {
      return false;
    }
  }, []);

  // Check if any loaded models are using ROCm
  const checkForRocmUsage = useCallback(async () => {
    // Don't show if user has permanently dismissed
    if (isSystemChecksDismissed()) {
      return;
    }

    // Don't show if there are no system checks
    if (systemChecks.length === 0) {
      setShouldShowSystemChecks(false);
      return;
    }

    try {
      const { serverFetch } = await import('../utils/serverConfig');
      const response = await serverFetch('/health');
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const allModelsLoaded = data.all_models_loaded || [];

      // Check if any loaded model is using ROCm backend
      const hasRocmModel = allModelsLoaded.some((model: any) => {
        const recipeOptions = model.recipe_options || {};
        const recipe = model.recipe || '';

        // Check for ROCm in llamacpp backend
        if (recipe === 'llamacpp' && recipeOptions.llamacpp_backend === 'rocm') {
          return true;
        }

        // Check for ROCm in sd-cpp backend
        if (recipe === 'sd-cpp' && recipeOptions['sd-cpp_backend'] === 'rocm') {
          return true;
        }

        return false;
      });

      setShouldShowSystemChecks(hasRocmModel);
    } catch (error) {
      console.error('Failed to check for ROCm usage:', error);
    }
  }, [systemChecks, isSystemChecksDismissed]);

  // Dismiss system checks modal
  const dismissSystemChecks = useCallback((permanent: boolean) => {
    setShouldShowSystemChecks(false);
    if (permanent) {
      try {
        localStorage.setItem(SYSTEM_CHECKS_DISMISSED_KEY, 'true');
      } catch (error) {
        console.error('Failed to save dismiss preference:', error);
      }
    }
  }, []);

  // No initial load - system info will be fetched when first needed
  // (e.g., when user tries to load a model)

  const value: SystemContextValue = {
    systemInfo,
    supportedRecipes,
    systemChecks,
    shouldShowSystemChecks,
    isLoading,
    refresh,
    ensureSystemInfoLoaded,
    checkForRocmUsage,
    dismissSystemChecks,
  };

  return (
      <SystemContext.Provider value={value}>
        {children}
      </SystemContext.Provider>
  );
};

export const useSystem = (): SystemContextValue => {
  const context = useContext(SystemContext);
  if (!context) {
    throw new Error('useSystem must be used within a SystemProvider');
  }
  return context;
};
