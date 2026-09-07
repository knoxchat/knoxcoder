import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

function Toggle(props: {
  optionOne: string;
  optionTwo: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center text-center mx-auto w-fit">
      <ToggleGroup 
        type="single" 
        value={props.selected ? "option1" : "option2"}
        onValueChange={(value) => {
          if (value) props.onClick();
        }}
        className={cn(
          "border border-lightgray bg-vsc-input-background rounded-none",
          "hover:bg-lightgray/35"
        )}
      >
        <ToggleGroupItem 
          value="option1" 
          className={cn(
            "text-center px-3 py-2 rounded-none transition-all duration-200",
            props.selected && "bg-list-active text-list-active-foreground"
          )}
        >
          {props.optionOne}
        </ToggleGroupItem>
        <ToggleGroupItem 
          value="option2"
          className={cn(
            "text-center px-3 py-2 rounded-none transition-all duration-200",
            !props.selected && "bg-list-active text-list-active-foreground"
          )}
        >
          {props.optionTwo}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

export default Toggle;
