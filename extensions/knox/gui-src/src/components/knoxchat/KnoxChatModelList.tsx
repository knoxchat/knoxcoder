import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import { 
  defaultBorderRadius, 
  lightGray, 
  vscBackground, 
  vscForeground, 
  vscInputBackground, 
  vscListActiveBackground, 
  vscListActiveForeground,
  vscInputBorder
} from "..";
import { formatModelPricingPerMillion } from "core/llm/knoxChatModels";
import { CategorizedModelPackage } from "../../pages/AddNewModel/utils/fetchKnoxChatModels";
import { formatTokenCount } from "../../util/formatTokenCount";
import { MagnifyingGlassIcon } from "../../svg-icons";

interface KnoxChatModelListProps {
  models: CategorizedModelPackage[];
  selectedModel: CategorizedModelPackage | null;
  onSelectModel: (model: CategorizedModelPackage) => void;
  isLoading: boolean;
}

const SearchInput = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      "bg-vsc-input-background border border-vsc-input-border text-vsc-foreground",
      "rounded-none py-2.5 px-2.5 pl-10 text-sm leading-5 w-full",
      "focus:outline-none focus:border-lightgray",
      "placeholder:text-lightgray",
      className
    )}
    {...props}
  />
);

const ModelListContainer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("max-h-96 overflow-y-auto pr-2", className)} {...props} />
);

const CategoryTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-sm font-semibold mb-2 text-vsc-foreground", className)} {...props} />
);

const ModelItem = ({ 
  $isSelected, 
  className, 
  ...props 
}: React.HTMLAttributes<HTMLDivElement> & { $isSelected: boolean }) => (
  <div
    className={cn(
      "p-2 rounded-none cursor-pointer",
      $isSelected 
        ? "bg-list-active text-list-active-foreground border border-lightgray" 
        : "bg-vsc-input-background text-vsc-foreground border border-transparent",
      "hover:bg-list-active hover:text-list-active-foreground",
      className
    )}
    {...props}
  />
);

const ModelTitle = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("font-medium overflow-hidden text-ellipsis whitespace-nowrap mr-2", className)} {...props} />
);

const MetaBadge = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div 
    className={cn("text-xs bg-vsc-background rounded-none py-0.5 px-1.5 text-lightgray whitespace-nowrap", className)} 
    {...props} 
  />
);

const ModelId = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("text-xs text-lightgray mt-1 overflow-hidden text-ellipsis whitespace-nowrap", className)} {...props} />
);

const LoadingContainer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center justify-center h-40", className)} {...props} />
);

const LoadingText = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("text-sm text-lightgray", className)} {...props} />
);

const NoResultsContainer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("text-center text-sm text-lightgray my-8", className)} {...props} />
);

const SearchIconContainer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div 
    className={cn("absolute top-1/2 left-3 -translate-y-1/2 pointer-events-none text-lightgray w-4 h-4", className)} 
    {...props} 
  />
);

/**
 * Groups models by category
 * @param models List of categorized models
 * @returns Map of categories to models
 */
const groupModelsByCategory = (models: CategorizedModelPackage[]) => {
  const groupedModels: Record<string, CategorizedModelPackage[]> = {};
  
  models.forEach(model => {
    if (!groupedModels[model.category]) {
      groupedModels[model.category] = [];
    }
    groupedModels[model.category].push(model);
  });
  
  // Sort categories alphabetically, but put Other Models at the end
  return Object.keys(groupedModels)
    .sort((a, b) => {
      if (a === 'Other Models') {return 1;}
      if (b === 'Other Models') {return -1;}
      return a.localeCompare(b);
    })
    .reduce((acc, key) => {
      acc[key] = groupedModels[key];
      return acc;
    }, {} as Record<string, CategorizedModelPackage[]>);
};

const KnoxChatModelList = ({ models, selectedModel, onSelectModel, isLoading }: KnoxChatModelListProps) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  
  // Filter models based on search term (only matching against model ID)
  const filteredModels = searchTerm.trim() === "" 
    ? models 
    : models.filter(model => 
        model.params.model.toLowerCase().includes(searchTerm.toLowerCase())
      );
  
  // Group filtered models by category
  const groupedModels = groupModelsByCategory(filteredModels);
  
  if (isLoading) {
    return (
      <LoadingContainer>
        <LoadingText>{t('loading')}</LoadingText>
      </LoadingContainer>
    );
  }
  
  if (models.length === 0) {
    return (
      <LoadingContainer>
        <LoadingText>{t('cannotLoadModels')}</LoadingText>
      </LoadingContainer>
    );
  }
  
  return (
    <div className="w-full mt-2">
      {/* Search bar */}
      <div className="relative mb-4">
        <SearchIconContainer>
          <MagnifyingGlassIcon />
        </SearchIconContainer>
        <SearchInput
          type="text"
          placeholder={t('searchEllipsis')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      
      {/* Model list grouped by category */}
      <ModelListContainer>
        {Object.keys(groupedModels).length === 0 ? (
          <NoResultsContainer>
            {t('noMatchingModelIds')}
          </NoResultsContainer>
        ) : (
          Object.entries(groupedModels).map(([category, categoryModels]) => (
            <div key={category} className="mb-4">
              <CategoryTitle>{category === 'Other Models' ? t('otherModels') : category}</CategoryTitle>
              <div className="space-y-2">
                {categoryModels.map((model) => {
                  const pricingLabel = model.pricing
                    ? formatModelPricingPerMillion(model.pricing)
                    : undefined;
                  return (
                  <ModelItem
                    key={model.params.model}
                    $isSelected={selectedModel?.params.model === model.params.model}
                    onClick={() => onSelectModel(model)}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <ModelTitle>{model.title}</ModelTitle>
                      <div className="flex items-center gap-1 shrink-0">
                        <MetaBadge
                          title={
                            Number.isFinite(model.params.contextLength)
                              ? model.params.contextLength.toLocaleString()
                              : undefined
                          }
                        >
                          {Number.isFinite(model.params.contextLength)
                            ? formatTokenCount(model.params.contextLength)
                            : "∞"}
                        </MetaBadge>
                        {model.maxTokens != null && (
                          <MetaBadge
                            title={`Max completion tokens: ${model.maxTokens.toLocaleString()}`}
                          >
                            ↑{formatTokenCount(model.maxTokens)}
                          </MetaBadge>
                        )}
                      </div>
                    </div>
                    <ModelId>
                      {t('idPrefix', { id: model.params.model })}
                    </ModelId>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {model.supportsTools && <MetaBadge>tools</MetaBadge>}
                      {model.supportsReasoning && <MetaBadge>reasoning</MetaBadge>}
                      {model.supportsWebSearch && <MetaBadge>web</MetaBadge>}
                      {model.supportsImageOutput && <MetaBadge>img-out</MetaBadge>}
                      {pricingLabel && (
                        <MetaBadge title={pricingLabel.title}>
                          {pricingLabel.badge}
                        </MetaBadge>
                      )}
                      {(model.modalities ?? [])
                        .filter((m) => m !== "text")
                        .map((modality) => (
                          <MetaBadge key={modality}>{modality}</MetaBadge>
                        ))}
                    </div>
                  </ModelItem>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </ModelListContainer>
    </div>
  );
};

export default KnoxChatModelList; 