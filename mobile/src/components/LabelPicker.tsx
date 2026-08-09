import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ScrollView,
} from 'react-native';

interface Label {
  id: string;
  name: string;
  color?: string;
}

interface LabelPickerProps {
  availableLabels: Label[];
  selectedLabels?: Label[];
  onChange: (labels: Label[]) => void;
}

const DEFAULT_LABEL_COLORS: Record<string, string> = {
  bug: '#d9534f',
  feature: '#5cb85c',
  enhancement: '#5bc0de',
  documentation: '#0275d8',
  'in-progress': '#f0ad4e',
  blocked: '#ec971f',
};

export function LabelPicker({
  availableLabels,
  selectedLabels = [],
  onChange,
}: LabelPickerProps) {
  const [showModal, setShowModal] = useState(false);

  const handleToggleLabel = (label: Label) => {
    const isSelected = selectedLabels.some((l) => l.id === label.id);
    if (isSelected) {
      onChange(selectedLabels.filter((l) => l.id !== label.id));
    } else {
      onChange([...selectedLabels, label]);
    }
  };

  const getColorForLabel = (label: Label): string => {
    return (
      label.color ||
      DEFAULT_LABEL_COLORS[label.name.toLowerCase()] ||
      '#0066cc'
    );
  };

  const renderLabelBadge = (label: Label) => (
    <View
      key={label.id}
      style={[
        styles.labelBadge,
        { backgroundColor: getColorForLabel(label) },
      ]}
    >
      <Text style={styles.labelText}>{label.name}</Text>
    </View>
  );

  const renderLabelOption = ({ item }: { item: Label }) => {
    const isSelected = selectedLabels.some((l) => l.id === item.id);
    return (
      <TouchableOpacity
        style={[
          styles.labelOption,
          isSelected && styles.labelOptionSelected,
        ]}
        onPress={() => handleToggleLabel(item)}
      >
        <View
          style={[
            styles.labelCheckbox,
            isSelected && styles.labelCheckboxSelected,
          ]}
        >
          {isSelected && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <View
          style={[
            styles.labelOptionBadge,
            { backgroundColor: getColorForLabel(item) },
          ]}
        />
        <Text style={styles.labelOptionName}>{item.name}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowModal(true)}
      >
        <Text style={styles.buttonText}>
          {selectedLabels.length > 0
            ? `${selectedLabels.length} label${selectedLabels.length !== 1 ? 's' : ''}`
            : 'Add labels...'}
        </Text>
      </TouchableOpacity>

      {selectedLabels.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.selectedLabelsContainer}
        >
          {selectedLabels.map((label) => renderLabelBadge(label))}
        </ScrollView>
      )}

      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Labels</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={styles.modalCloseButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={availableLabels}
              keyExtractor={(item) => item.id}
              renderItem={renderLabelOption}
            />

            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setShowModal(false)}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  button: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f9f9f9',
  },
  buttonText: {
    fontSize: 14,
    color: '#333',
  },
  selectedLabelsContainer: {
    marginTop: 8,
    paddingRight: 12,
  },
  labelBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  labelText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  modalCloseButton: {
    fontSize: 20,
    color: '#999',
  },
  labelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  labelOptionSelected: {
    backgroundColor: '#f0f7ff',
  },
  labelCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#ddd',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelCheckboxSelected: {
    backgroundColor: '#0066cc',
    borderColor: '#0066cc',
  },
  checkmark: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  labelOptionBadge: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  labelOptionName: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  doneButton: {
    backgroundColor: '#0066cc',
    margin: 16,
    paddingVertical: 12,
    borderRadius: 6,
  },
  doneButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
