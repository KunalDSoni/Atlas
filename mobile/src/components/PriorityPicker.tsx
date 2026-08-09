import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
} from 'react-native';

export type Priority = 'Lowest' | 'Low' | 'Medium' | 'High' | 'Highest';

interface PriorityPickerProps {
  value?: Priority;
  onChange: (priority: Priority) => void;
}

const PRIORITIES: Priority[] = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];

const PRIORITY_COLORS: Record<Priority, string> = {
  Lowest: '#5cb85c',
  Low: '#5bc0de',
  Medium: '#f0ad4e',
  High: '#ec971f',
  Highest: '#d9534f',
};

const PRIORITY_ICONS: Record<Priority, string> = {
  Lowest: '↓',
  Low: '↓',
  Medium: '→',
  High: '↑',
  Highest: '↑↑',
};

export function PriorityPicker({ value, onChange }: PriorityPickerProps) {
  const [showModal, setShowModal] = useState(false);

  const handleSelect = (priority: Priority) => {
    onChange(priority);
    setShowModal(false);
  };

  const renderPriorityOption = ({ item }: { item: Priority }) => {
    const isSelected = value === item;
    return (
      <TouchableOpacity
        style={[
          styles.option,
          isSelected && styles.optionSelected,
        ]}
        onPress={() => handleSelect(item)}
      >
        <View style={styles.optionLeft}>
          <View
            style={[
              styles.colorDot,
              { backgroundColor: PRIORITY_COLORS[item] },
            ]}
          />
          <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
            {item}
          </Text>
        </View>
        {isSelected && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>
    );
  };

  const getPriorityDisplay = () => {
    if (!value) return 'No priority';
    return (
      <View style={styles.displayContainer}>
        <View
          style={[
            styles.displayDot,
            { backgroundColor: PRIORITY_COLORS[value] },
          ]}
        />
        <Text style={styles.displayText}>{value}</Text>
        <Text style={styles.displayIcon}>{PRIORITY_ICONS[value]}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowModal(true)}
      >
        {getPriorityDisplay()}
      </TouchableOpacity>

      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Priority</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={styles.modalCloseButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={PRIORITIES}
              keyExtractor={(item) => item}
              renderItem={renderPriorityOption}
            />

            {value && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  onChange(undefined as any);
                  setShowModal(false);
                }}
              >
                <Text style={styles.clearButtonText}>Clear Priority</Text>
              </TouchableOpacity>
            )}
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
  displayContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  displayText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  displayIcon: {
    fontSize: 12,
    color: '#999',
    marginLeft: 8,
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
    maxHeight: '70%',
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
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  optionSelected: {
    backgroundColor: '#f0f7ff',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  optionText: {
    fontSize: 14,
    color: '#333',
  },
  optionTextSelected: {
    fontWeight: '600',
  },
  checkmark: {
    fontSize: 16,
    color: '#0066cc',
    fontWeight: 'bold',
  },
  clearButton: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingVertical: 12,
    margin: 16,
    alignItems: 'center',
  },
  clearButtonText: {
    color: '#d9534f',
    fontSize: 14,
    fontWeight: '600',
  },
});
