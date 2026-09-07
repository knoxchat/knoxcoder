import React from "react";
import { NumberInput as ShadcnNumberInput } from "@/components/ui/number-input";

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  max: number;
  min: number;
}

const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  max,
  min,
}) => {
  return (
    <ShadcnNumberInput
      value={value}
      onChange={onChange}
      max={max}
      min={min}
    />
  );
};

export default NumberInput;
