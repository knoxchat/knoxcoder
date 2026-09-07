import * as React from "react"
import { useTranslation } from "react-i18next"
import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { Input } from "./input"

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  max: number
  min: number
  step?: number
  disabled?: boolean
  className?: string
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onChange, max, min, step = 1, disabled = false, ...props }, ref) => {
    const { t } = useTranslation()
    const [localValue, setLocalValue] = React.useState<string>(value.toString())
    
    // Update local value when prop changes
    React.useEffect(() => {
      setLocalValue(value.toString())
    }, [value])
    
    const handleIncrement = React.useCallback(() => {
      if (value < max) {
        const newValue = Math.min(value + step, max)
        onChange(newValue)
      }
    }, [value, max, step, onChange])

    const handleDecrement = React.useCallback(() => {
      if (value > min) {
        const newValue = Math.max(value - step, min)
        onChange(newValue)
      }
    }, [value, min, step, onChange])

    const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value
      setLocalValue(inputValue)
      
      const newValue = parseInt(inputValue, 10)
      if (!isNaN(newValue)) {
        // Clamp the value between min and max
        const clampedValue = Math.min(Math.max(newValue, min), max)
        if (clampedValue !== value) {
          onChange(clampedValue)
        }
      }
    }, [value, min, max, onChange])
    
    const handleBlur = React.useCallback(() => {
      // When input loses focus, ensure we display a valid value
      if (localValue === '' || isNaN(parseInt(localValue, 10))) {
        setLocalValue(value.toString())
      } else {
        const parsed = parseInt(localValue, 10)
        const clampedValue = Math.min(Math.max(parsed, min), max)
        setLocalValue(clampedValue.toString())
        if (clampedValue !== value) {
          onChange(clampedValue)
        }
      }
    }, [localValue, value, min, max, onChange])
    
    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        handleIncrement()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        handleDecrement()
      }
    }, [handleIncrement, handleDecrement])

    return (
      <div className={cn("flex items-center", className)}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-r-none border-r-0"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
          aria-label={t('decreaseValue')}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          ref={ref}
          type="text"
          inputMode="numeric"
          value={localValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="h-9 rounded-none border-x-0 text-center focus-visible:z-10"
          style={{ width: '80px' }}
          aria-label={t('numberInput')}
          {...props}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-l-none border-l-0"
          onClick={handleIncrement}
          disabled={disabled || value >= max}
          aria-label={t('increaseValue')}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    )
  }
)

NumberInput.displayName = "NumberInput"

export { NumberInput }
