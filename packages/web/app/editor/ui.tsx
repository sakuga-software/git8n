import { Checkbox } from '@heroui/react/checkbox';
import { ListBox } from '@heroui/react/list-box';
import { Select } from '@heroui/react/select';
import { Spinner } from '@heroui/react/spinner';

/**
 * React Aria reads an empty key as « no selection ». The file filter uses ""
 * for « every file », so the two values trade through this name, as the
 * selects of the admin do.
 */
const NO_VALUE = '__none__';

const toKey = (value: string): string => (value === '' ? NO_VALUE : value);
const fromKey = (key: unknown): string => (key === NO_VALUE || key === null ? '' : String(key));

export interface ChoiceItem {
  value: string;
  label: string;
}

/**
 * A select of the editor: the button and the list box of HeroUI, with the
 * keyboard and the search by first letter that a native select gives.
 *
 * `label` names it for a reader of the screen. The visible label, if there is
 * one, is drawn by the caller beside it.
 */
export function Choice({
  label,
  value,
  items,
  onChange,
  isDisabled,
  className,
}: {
  label: string;
  value: string;
  items: readonly ChoiceItem[];
  onChange: (value: string) => void;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      aria-label={label}
      selectedKey={toKey(value)}
      onSelectionChange={(key) => onChange(fromKey(key))}
      isDisabled={isDisabled}
      className={className}
    >
      <Select.Trigger className="h-9 min-h-0">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="max-h-80">
        <ListBox>
          {items.map((item) => (
            // A test finds an entry by its value, which no text carries for « every file ».
            <ListBox.Item key={toKey(item.value)} id={toKey(item.value)} textValue={item.label} data-value={item.value}>
              {item.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** A box with no text beside it: its name is for a reader of the screen. */
export function Tick({
  label,
  isSelected,
  isIndeterminate,
  isDisabled,
  onChange,
}: {
  label: string;
  isSelected: boolean;
  isIndeterminate?: boolean;
  isDisabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Checkbox
      aria-label={label}
      isSelected={isSelected}
      isIndeterminate={isIndeterminate}
      isDisabled={isDisabled}
      onChange={onChange}
    >
      {/* The content is the part that is clicked and that holds the input. Without it, nothing is. */}
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Content>
    </Checkbox>
  );
}

/** The spinner of a control that works: it takes the colour of the text around it. */
export function Busy() {
  return <Spinner size="sm" color="current" />;
}
